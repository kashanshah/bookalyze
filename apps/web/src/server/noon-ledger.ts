import "server-only";
import {
  addDaysIso,
  NOON_LEDGER_EXPORT,
  nextNoonWindow,
  noonReportParams,
  parseNoonLedger,
  previewReport,
} from "@bookalyze/core";
import {
  getConnection,
  getDb,
  getNoonConnection,
  importNoonLedger,
  type NoonTransactionsSync,
  noonSyncState,
  saveNoonSyncState,
  withOrg,
} from "@bookalyze/db";
import { audit } from "./audit";
import { openNoonCredentials } from "./commerce";
import { logInfo, logWarn } from "./log";
import { createNoonExport, downloadNoonExport, NoonError, noonExportStatus } from "./noon";

/**
 * Bringing Noon's FBN inventory ledger in through its export API, like the transaction view: a
 * year back, one calendar month per export, up to yesterday, then the last weeks again now and
 * then. One export covers every Noon country; each row goes to the company's Noon channel for
 * its country. An export not ready yet is kept on the connection (`settings.ledger`) and the next
 * run carries on with it. Nothing here posts: the movements count when a month's cost of goods
 * sold is posted.
 */

export type NoonLedgerResult = {
  added: number;
  through: string | null;
  working: { from: string; to: string } | null;
  more: boolean;
  /** Countries in Noon's ledger the company hasn't added as Noon channels. */
  countriesMissing: string[];
  error: string | null;
};

type SyncContext = { orgId: string; userId: string | null };

const POLL_MS = 2_500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Null when Noon isn't connected. */
export async function syncNoonLedger(
  ctx: SyncContext,
  today: string,
  budgetMs: number,
): Promise<NoonLedgerResult | null> {
  const deadline = Date.now() + budgetMs;
  const connection = await withOrg(getDb(), ctx, async (tx) => {
    const found = await getNoonConnection(tx);
    return found ? getConnection(tx, found.id) : null;
  });
  if (!connection?.secret || connection.status === "disconnected") return null;

  let state: NoonTransactionsSync = noonSyncState(connection.settings, "ledger");
  const result: NoonLedgerResult = {
    added: 0,
    through: state.through,
    working: null,
    more: false,
    countriesMissing: [],
    error: null,
  };
  const reports = Array.isArray(connection.settings.reports) ? connection.settings.reports : [];
  if (!reports.includes(NOON_LEDGER_EXPORT)) {
    result.error =
      "Noon's key can't download the FBN inventory ledger. Give the service account a role that can see FBN inventory, then test the connection again.";
    return result;
  }
  const params =
    connection.settings.reportParams && typeof connection.settings.reportParams === "object"
      ? (connection.settings.reportParams as Record<string, unknown>)[NOON_LEDGER_EXPORT]
      : null;
  const save = (next: NoonTransactionsSync) =>
    withOrg(getDb(), ctx, (tx) => saveNoonSyncState(tx, connection.id, next, "ledger"));
  const log = { orgId: ctx.orgId, connectionId: connection.id };

  try {
    const creds = openNoonCredentials(ctx.orgId, connection.id, connection.secret);
    for (;;) {
      let pending = state.pending;
      if (!pending) {
        if (Date.now() + 5_000 > deadline) {
          result.more = nextNoonWindow(state, today) !== null;
          break;
        }
        const window = nextNoonWindow(state, today);
        if (!window) break;
        const exportCode = await createNoonExport(
          creds,
          NOON_LEDGER_EXPORT,
          noonReportParams(params, window.from, window.to),
        );
        pending = { exportCode, from: window.from, to: window.to };
        state = { ...state, pending };
        await save(state);
        logInfo("noon.ledger_export_created", { ...log, ...pending });
      }

      const status = await noonExportStatus(creds, pending.exportCode);
      if (status.state === "failed") {
        logWarn("noon.ledger_export_failed", { ...log, ...pending, status: status.status });
        state = { ...state, pending: null };
        await save(state);
        result.error = `Noon couldn't make the FBN ledger for ${pending.from} to ${pending.to} (it says “${status.status}”). Try again later.`;
        break;
      }
      if (status.state !== "ready" || !status.downloadUrl) {
        if (Date.now() + POLL_MS > deadline) {
          result.working = { from: pending.from, to: pending.to };
          result.more = true;
          break;
        }
        await sleep(POLL_MS);
        continue;
      }

      const file = await downloadNoonExport(creds, status.downloadUrl);
      const text = new TextDecoder("utf-8").decode(file.bytes);
      // A month without a single movement may come back empty.
      const parsed = text.trim()
        ? parseNoonLedger(text)
        : ({ ok: true, events: [], from: null, to: null, skipped: 0 } as const);
      if (!parsed.ok) {
        const preview = previewReport(file.bytes, file.gzip);
        logWarn("noon.ledger_unreadable", {
          ...log,
          ...pending,
          kind: preview.kind,
          columns: preview.columns,
          contentType: file.contentType,
        });
        state = { ...state, pending: null };
        await save(state);
        result.error =
          "Noon's FBN ledger came back in a layout this page can't read yet. The details are in the server logs (noon.ledger_unreadable).";
        break;
      }

      const window = pending;
      const imported = await withOrg(getDb(), ctx, async (tx) => {
        const saved = await importNoonLedger(tx, {
          orgId: ctx.orgId,
          events: parsed.events,
          through: window.to,
        });
        const through = state.through && state.through > window.to ? state.through : window.to;
        const refreshedAt =
          window.to >= addDaysIso(today, -1) ? new Date().toISOString() : state.refreshedAt;
        state = { through, pending: null, refreshedAt };
        await saveNoonSyncState(tx, connection.id, state, "ledger");
        if (saved.added) {
          await audit(tx, {
            orgId: ctx.orgId,
            actorUserId: ctx.userId,
            action: "inventory_ledger.imported",
            entityType: "connection",
            entityId: connection.id,
            after: { provider: "noon", from: window.from, to: window.to, added: saved.added },
          });
        }
        return saved;
      });
      logInfo("noon.ledger_imported", {
        ...log,
        from: window.from,
        to: window.to,
        rows: parsed.events.length,
        skipped: parsed.skipped,
        added: imported.added,
        countriesMissing: imported.countriesMissing,
      });
      result.added += imported.added;
      for (const c of imported.countriesMissing) {
        if (!result.countriesMissing.includes(c)) result.countriesMissing.push(c);
      }
      result.through = state.through;
    }
  } catch (error) {
    if (!(error instanceof NoonError)) throw error;
    result.error = error.message;
    result.more = false;
  }
  return result;
}
