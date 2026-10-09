import "server-only";
import {
  addDaysIso,
  NOON_TRANSACTIONS_EXPORT,
  nextNoonWindow,
  noonPayoutsParams,
  parseNoonTransactions,
  previewReport,
} from "@bookalyze/core";
import {
  getConnection,
  getDb,
  getNoonConnection,
  importNoonTransactions,
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
 * Bringing Noon's transaction view in through its export API, within a time budget: a year
 * back, one calendar month per export, up to yesterday; once caught up, the last three weeks
 * again now and then (Noon adds late fees and updates to earlier orders). Noon makes each
 * export in the background, so an export asked for and not ready yet is kept on the connection
 * and the next run carries on with it. Nothing here posts to the books.
 */

export type NoonSyncResult = {
  /** Rows added and rows whose amounts were refreshed. */
  added: number;
  updated: number;
  /** Days through this one are in. */
  through: string | null;
  /** The days Noon is making a report for right now. */
  working: { from: string; to: string } | null;
  /** More to do: run again. */
  more: boolean;
  /** Noon countries added because rows came in for them. */
  channelsAdded: string[];
  error: string | null;
};

type SyncContext = { orgId: string; userId: string | null };

const POLL_MS = 2_500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function syncNoonTransactions(
  ctx: SyncContext,
  today: string,
  budgetMs: number,
): Promise<NoonSyncResult | null> {
  const deadline = Date.now() + budgetMs;
  const connection = await withOrg(getDb(), ctx, async (tx) => {
    const found = await getNoonConnection(tx);
    return found ? getConnection(tx, found.id) : null;
  });
  if (!connection?.secret || connection.status === "disconnected") return null;

  let state: NoonTransactionsSync = noonSyncState(connection.settings);
  const result: NoonSyncResult = {
    added: 0,
    updated: 0,
    through: state.through,
    working: null,
    more: false,
    channelsAdded: [],
    error: null,
  };
  const save = (next: NoonTransactionsSync) =>
    withOrg(getDb(), ctx, (tx) => saveNoonSyncState(tx, connection.id, next));
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
          NOON_TRANSACTIONS_EXPORT,
          noonPayoutsParams(connection.settings.payoutsParams, window.from, window.to),
        );
        pending = { exportCode, from: window.from, to: window.to };
        state = { ...state, pending };
        await save(state);
        logInfo("noon.transactions_export_created", { ...log, ...pending });
      }

      const status = await noonExportStatus(creds, pending.exportCode);
      if (status.state === "failed") {
        logWarn("noon.transactions_export_failed", { ...log, ...pending, status: status.status });
        state = { ...state, pending: null };
        await save(state);
        result.error = `Noon couldn't make the report for ${pending.from} to ${pending.to} (it says “${status.status}”). Try again later.`;
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
      // A month without a single transaction may come back empty.
      const parsed = text.trim()
        ? parseNoonTransactions(text)
        : ({ ok: true, rows: [], skipped: 0, from: null, to: null } as const);
      if (!parsed.ok) {
        const preview = previewReport(file.bytes, file.gzip);
        logWarn("noon.transactions_unreadable", {
          ...log,
          ...pending,
          kind: preview.kind,
          columns: preview.columns,
          contentType: file.contentType,
        });
        state = { ...state, pending: null };
        await save(state);
        result.error =
          "Noon's report came back in a layout this page can't read yet. The details are in the server logs (noon.transactions_unreadable).";
        break;
      }

      const window = pending;
      const imported = await withOrg(getDb(), ctx, async (tx) => {
        const saved = await importNoonTransactions(tx, {
          orgId: ctx.orgId,
          rows: parsed.rows,
          source: "api",
          connectionId: connection.id,
        });
        const through = state.through && state.through > window.to ? state.through : window.to;
        // Reading through yesterday also counts as reading the last weeks again.
        const refreshedAt =
          window.to >= addDaysIso(today, -1) ? new Date().toISOString() : state.refreshedAt;
        state = { through, pending: null, refreshedAt };
        await saveNoonSyncState(tx, connection.id, state);
        if (saved.added || saved.updated || saved.channelsAdded.length) {
          await audit(tx, {
            orgId: ctx.orgId,
            actorUserId: ctx.userId,
            action: "noon.transactions_imported",
            entityType: "connection",
            entityId: connection.id,
            after: { from: window.from, to: window.to, source: "api", ...saved },
          });
        }
        return saved;
      });
      logInfo("noon.transactions_imported", {
        ...log,
        from: window.from,
        to: window.to,
        rows: parsed.rows.length,
        skipped: parsed.skipped,
        added: imported.added,
        updated: imported.updated,
        unknownCurrency: imported.unknownCurrency,
      });
      result.added += imported.added;
      result.updated += imported.updated;
      result.channelsAdded.push(...imported.channelsAdded);
      result.through = state.through;
    }
  } catch (error) {
    if (!(error instanceof NoonError)) throw error;
    // NoonError is logged where it's raised, with Noon's request ID.
    result.error = error.message;
    result.more = false;
  }
  return result;
}
