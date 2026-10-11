import "server-only";
import {
  addDaysIso,
  NOON_LEDGER_EXPORT,
  NOON_SUMMARY_EXPORT,
  nextNoonWindow,
  noonReportParams,
  parseNoonLedger,
  parseNoonStockSummary,
  previewReport,
} from "@bookalyze/core";
import {
  getConnection,
  getDb,
  getNoonConnection,
  importNoonLedger,
  importNoonStockDays,
  type NoonSyncKey,
  type NoonTransactionsSync,
  noonSyncState,
  saveNoonSyncState,
  type Transaction,
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
 * sold is posted. Noon's summary view comes in the same way after it (`settings.summary`), where
 * the key can download it: it says what Noon holds, and checks the detailed ledger.
 */

export type NoonLedgerResult = {
  added: number;
  through: string | null;
  working: { from: string; to: string } | null;
  more: boolean;
  /** Countries in Noon's ledger the company hasn't added as Noon channels. */
  countriesMissing: string[];
  error: string | null;
  /** Noon's summary view: days saved, in through. Null when the key can't download it. */
  summary: { saved: number; through: string | null; more: boolean; error: string | null } | null;
};

type SyncContext = { orgId: string; userId: string | null };

type Saved = { added: number; countriesMissing: string[]; rows: number; skipped: number };

/** One of Noon's FBN ledger exports, brought in a month at a time. */
type LedgerExport = {
  name: string;
  key: NoonSyncKey;
  /** Log event prefix: `noon.${log}_imported`… */
  log: string;
  /** "FBN ledger", "FBN ledger summary": for messages. */
  label: string;
  /** Reads one window's file; null when it isn't in a layout this page reads. */
  read: (text: string) => ((tx: Transaction, window: { to: string }) => Promise<Saved>) | null;
};

type ExportRun = Omit<NoonLedgerResult, "summary">;

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
  const conn = { id: connection.id, secret: connection.secret, settings: connection.settings };
  const reports = Array.isArray(connection.settings.reports) ? connection.settings.reports : [];
  const ledger: LedgerExport = {
    name: NOON_LEDGER_EXPORT,
    key: "ledger",
    log: "ledger",
    label: "FBN ledger",
    read: (text) => {
      // A month without a single movement may come back empty.
      const parsed = text.trim()
        ? parseNoonLedger(text)
        : ({ ok: true, events: [], from: null, to: null, skipped: 0 } as const);
      if (!parsed.ok) return null;
      return async (tx, window) => ({
        ...(await importNoonLedger(tx, {
          orgId: ctx.orgId,
          events: parsed.events,
          through: window.to,
        })),
        rows: parsed.events.length,
        skipped: parsed.skipped,
      });
    },
  };
  const summary: LedgerExport = {
    name: NOON_SUMMARY_EXPORT,
    key: "summary",
    log: "summary",
    label: "FBN ledger summary",
    read: (text) => {
      const parsed = text.trim()
        ? parseNoonStockSummary(text)
        : ({ ok: true, rows: [], from: null, to: null, skipped: 0 } as const);
      if (!parsed.ok) return null;
      return async (tx) => {
        const saved = await importNoonStockDays(tx, { orgId: ctx.orgId, rows: parsed.rows });
        return {
          added: saved.saved,
          countriesMissing: [],
          rows: parsed.rows.length,
          skipped: parsed.skipped,
        };
      };
    },
  };

  const result: NoonLedgerResult = {
    ...(reports.includes(NOON_LEDGER_EXPORT)
      ? await runExport(ctx, conn, ledger, today, deadline)
      : {
          added: 0,
          through: noonSyncState(connection.settings, "ledger").through,
          working: null,
          more: false,
          countriesMissing: [],
          error:
            "Noon's key can't download the FBN inventory ledger. Give the service account a role that can see FBN inventory, then test the connection again.",
        }),
    summary: null,
  };
  if (reports.includes(NOON_SUMMARY_EXPORT)) {
    // The detailed ledger first: cost of goods sold waits for it. The summary gets what's left.
    const run = result.more ? null : await runExport(ctx, conn, summary, today, deadline);
    const state = noonSyncState(connection.settings, "summary");
    result.summary = run
      ? { saved: run.added, through: run.through, more: run.more, error: run.error }
      : { saved: 0, through: state.through, more: true, error: null };
  }
  return result;
}

async function runExport(
  ctx: SyncContext,
  connection: { id: string; secret: string; settings: Record<string, unknown> },
  report: LedgerExport,
  today: string,
  deadline: number,
): Promise<ExportRun> {
  let state: NoonTransactionsSync = noonSyncState(connection.settings, report.key);
  const result: ExportRun = {
    added: 0,
    through: state.through,
    working: null,
    more: false,
    countriesMissing: [],
    error: null,
  };
  const params =
    connection.settings.reportParams && typeof connection.settings.reportParams === "object"
      ? (connection.settings.reportParams as Record<string, unknown>)[report.name]
      : null;
  const save = (next: NoonTransactionsSync) =>
    withOrg(getDb(), ctx, (tx) => saveNoonSyncState(tx, connection.id, next, report.key));
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
          report.name,
          noonReportParams(params, window.from, window.to),
        );
        pending = { exportCode, from: window.from, to: window.to };
        state = { ...state, pending };
        await save(state);
        logInfo(`noon.${report.log}_export_created`, { ...log, ...pending });
      }

      const status = await noonExportStatus(creds, pending.exportCode);
      if (status.state === "failed") {
        logWarn(`noon.${report.log}_export_failed`, {
          ...log,
          ...pending,
          status: status.status,
        });
        state = { ...state, pending: null };
        await save(state);
        result.error = `Noon couldn't make the ${report.label} for ${pending.from} to ${pending.to} (it says “${status.status}”). Try again later.`;
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
      const write = report.read(new TextDecoder("utf-8").decode(file.bytes));
      if (!write) {
        const preview = previewReport(file.bytes, file.gzip);
        logWarn(`noon.${report.log}_unreadable`, {
          ...log,
          ...pending,
          kind: preview.kind,
          columns: preview.columns,
          contentType: file.contentType,
        });
        state = { ...state, pending: null };
        await save(state);
        result.error = `Noon's ${report.label} came back in a layout this page can't read yet. The details are in the server logs (noon.${report.log}_unreadable).`;
        break;
      }

      const window = pending;
      const imported = await withOrg(getDb(), ctx, async (tx) => {
        const saved = await write(tx, window);
        const through = state.through && state.through > window.to ? state.through : window.to;
        const refreshedAt =
          window.to >= addDaysIso(today, -1) ? new Date().toISOString() : state.refreshedAt;
        state = { through, pending: null, refreshedAt };
        await saveNoonSyncState(tx, connection.id, state, report.key);
        if (saved.added) {
          await audit(tx, {
            orgId: ctx.orgId,
            actorUserId: ctx.userId,
            action: report.key === "ledger" ? "inventory_ledger.imported" : "noon_stock.imported",
            entityType: "connection",
            entityId: connection.id,
            after: { provider: "noon", from: window.from, to: window.to, added: saved.added },
          });
        }
        return saved;
      });
      logInfo(`noon.${report.log}_imported`, {
        ...log,
        from: window.from,
        to: window.to,
        rows: imported.rows,
        skipped: imported.skipped,
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
