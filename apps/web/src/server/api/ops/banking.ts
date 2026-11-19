import "server-only";
import {
  type DateOrder,
  guessStatementColumns,
  isMoneyAccountSubtype,
  mappingFromSettings,
  readCsvTable,
  readStatement,
  STATEMENT_FIELDS,
  type StatementMapping,
  type StatementSettings,
  statementAccounts,
  statementDateOrder,
  statementSettings,
} from "@bookalyze/core";
import { listConnections } from "@bookalyze/db";
import { z } from "zod";
import {
  attachToEntryAction,
  completeUploadAction,
  entryAttachmentsAction,
  requestUploadAction,
} from "@/app/o/[slug]/accounting/receipts/actions";
import { syncConnectionAction, uploadStatementAction } from "@/app/o/[slug]/banking/actions";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { getAccountingContext, getBankingContext, inOrg, listAccounts } from "@/server/accounting";
import { ApiError, defineOperation, notFoundError, unwrap } from "../core";
import { company, id } from "./shared";

/** What one request may carry (Vercel refuses bodies over 4.5 MB). */
const MAX_CSV_CHARS = 4_000_000;
const CHUNK = 500;

export const bankingOperations = [
  defineOperation({
    name: "list_bank_connections",
    title: "Bank connections",
    description:
      "The company's bank connections (Wise by API, uploaded statements) and their feeds: which Bookalyze account each feeds, synced through what day, the bank's latest balance, and the last error if a sync failed.",
    access: "read",
    http: "GET /companies/{company}/bank-connections",
    input: z.object({ company }),
    run: async ({ input }) => {
      const ctx = await getBankingContext(input.company);
      const connections = await inOrg(ctx, (tx) => listConnections(tx));
      return connections
        .filter((c) => c.status !== "disconnected")
        .map((c) => ({
          id: c.id,
          provider: c.provider,
          name: c.name,
          status: c.status,
          lastSyncedAt: c.lastSyncedAt,
          lastError: c.lastError,
          feeds: c.feeds.map((f) => ({
            id: f.id,
            accountId: f.accountId,
            accountName: f.accountName,
            currency: f.currency,
            name: f.name,
            isActive: f.isActive,
            syncedThrough: f.syncedThrough,
            bankBalance: f.bankBalance,
            bankBalanceOn: f.bankBalanceOn,
          })),
        }));
    },
  }),

  defineOperation({
    name: "sync_bank_connection",
    title: "Sync a bank connection now",
    description:
      "Fetches new transactions from a connected bank (e.g. Wise) now, as Banking → Sync now does, and posts them (rules categorise what they match; possible duplicates are flagged). Returns how many were posted, already there, flagged and skipped.",
    access: "write",
    module: "banking",
    http: "POST /companies/{company}/bank-connections/{connectionId}/sync",
    input: z.object({ company, connectionId: id("bank connection") }),
    run: async ({ input }) =>
      unwrap(await syncConnectionAction(input.company, input.connectionId)).summary,
  }),

  defineOperation({
    name: "upload_bank_statement",
    title: "Upload a bank statement (CSV)",
    description: [
      "Brings a bank or card statement CSV into one bank, card or cash account, exactly like Banking → Upload a statement: rows already brought in are recognised and left alone, rules categorise what they match, and rows that look like a transaction already in the books are flagged as possible duplicates.",
      "Columns are read the way this account's last upload was read, or guessed from the headings; override with `columns` (field → heading). Use `dryRun: true` first to see how the file reads (columns, dates, first lines, problems) without saving.",
      "Fields: date, description, description2, amount (one signed column; `positiveIs` says whether a positive number is money in or out), moneyIn and moneyOut (two columns instead of amount), reference, balance, account.",
    ].join(" "),
    access: "write",
    module: "banking",
    http: "POST /companies/{company}/bank-accounts/{accountId}/statements",
    input: z.object({
      company,
      accountId: id("bank account"),
      csv: z.string().min(1).max(MAX_CSV_CHARS).describe("The CSV file's text."),
      columns: z
        .partialRecord(z.enum(STATEMENT_FIELDS), z.string().max(200))
        .optional()
        .describe('Which heading holds each field, e.g. {"date":"Date","amount":"Amount"}.'),
      dateOrder: z.enum(["ymd", "mdy", "dmy"]).optional(),
      positiveIs: z.enum(["in", "out"]).optional(),
      fileAccount: z
        .string()
        .max(12)
        .optional()
        .describe(
          "For files holding several accounts: the last characters of this account's number.",
        ),
      dryRun: z.boolean().optional(),
    }),
    run: async ({ input }) => {
      const ctx = await getBankingContext(input.company);
      const account = (await listAccounts(ctx)).find((a) => a.id === input.accountId);
      if (!account || account.isArchived || !isMoneyAccountSubtype(account.subtype)) {
        throw notFoundError("bank account");
      }
      const currency = account.currency ?? ctx.profile.baseCurrency;
      let table: ReturnType<typeof readCsvTable>;
      try {
        table = readCsvTable(input.csv);
      } catch {
        throw new ApiError(422, "invalid_request", "That text couldn't be read as CSV.");
      }
      if (!table.rows.length) {
        throw new ApiError(422, "invalid_request", "That file has no rows under its headings.");
      }

      // How this account's statements were read before, if ever.
      const saved = await inOrg(ctx, async (tx) => {
        for (const c of await listConnections(tx)) {
          const settings = c.settings.statement as StatementSettings | undefined;
          if (c.provider === "csv" && settings && c.feeds.some((f) => f.accountId === account.id))
            return settings;
        }
        return undefined;
      });
      const mapping: StatementMapping =
        (input.columns
          ? mappingFromSettings(table.headers, {
              columns: input.columns,
              dateOrder: input.dateOrder ?? "ymd",
              positiveIs: input.positiveIs ?? "in",
            })
          : saved
            ? mappingFromSettings(table.headers, saved)
            : null) ?? guessStatementColumns(table.headers, currency);
      if (input.columns) {
        const missing = Object.entries(input.columns).filter(
          ([, heading]) => !table.headers.includes(heading),
        );
        if (missing.length) {
          throw new ApiError(
            422,
            "invalid_request",
            `No column headed ${missing.map(([, h]) => `"${h}"`).join(", ")}. The headings are: ${table.headers.join(", ")}.`,
          );
        }
      }
      const split =
        mapping.moneyIn !== undefined && mapping.moneyOut !== undefined && !input.columns?.amount;
      if (split) delete mapping.amount;
      else {
        delete mapping.moneyIn;
        delete mapping.moneyOut;
      }
      if (
        mapping.date === undefined ||
        mapping.description === undefined ||
        (mapping.amount === undefined && !split)
      ) {
        throw new ApiError(
          422,
          "invalid_request",
          `Couldn't tell which columns hold the date, description and amount. Send \`columns\`. The headings are: ${table.headers.join(", ")}.`,
        );
      }
      const dateOrder: DateOrder =
        input.dateOrder ?? saved?.dateOrder ?? statementDateOrder(table, mapping).order;
      const positiveIs =
        input.positiveIs ??
        saved?.positiveIs ??
        (account.subtype === "credit_card" ? ("out" as const) : ("in" as const));

      // A file with several accounts in it: only this account's rows.
      const inFile = mapping.account !== undefined ? statementAccounts(table, mapping.account) : [];
      let fingerprint: string | undefined;
      let hint: string | undefined;
      if (inFile.length > 1) {
        const chosen = input.fileAccount
          ? inFile.find((a) => a.hint.endsWith(input.fileAccount ?? ""))
          : inFile.find((a) => a.fingerprint === saved?.account?.fingerprint);
        if (!chosen) {
          throw new ApiError(
            422,
            "invalid_request",
            `This file holds ${inFile.length} accounts (ending ${inFile.map((a) => a.hint).join(", ")}). Say which with \`fileAccount\`.`,
          );
        }
        fingerprint = chosen.fingerprint;
        hint = chosen.hint;
      }
      const options = {
        dateOrder,
        positiveIs,
        ...(fingerprint ? { accountFingerprint: fingerprint } : {}),
      };
      const read = readStatement(table, mapping, options, { accountId: account.id, currency });
      const columns = Object.fromEntries(
        Object.entries(mapping).map(([field, index]) => [field, table.headers[index as number]]),
      );
      if (input.dryRun || !read.lines.length) {
        return {
          dryRun: true,
          columns,
          dateOrder,
          positiveIs,
          rows: read.lines.length,
          firstDate: read.firstDate,
          lastDate: read.lastDate,
          closingBalance: read.closingBalance,
          otherAccounts: read.otherAccounts,
          problems: read.problems.slice(0, 50),
          sample: read.lines.slice(0, 5).map((l) => ({
            date: l.date,
            amount: l.amount,
            description: l.description,
          })),
        };
      }
      const settings = statementSettings(table.headers, mapping, options, hint);
      const total = { posted: 0, duplicates: 0, flagged: 0, categorized: 0, skipped: 0 };
      for (let i = 0; i < read.lines.length; i += CHUNK) {
        const lines = read.lines.slice(i, i + CHUNK).map((l) => ({
          externalId: l.externalId,
          date: l.date,
          amount: l.amount,
          description: l.description,
          reference: l.reference,
        }));
        const result = await uploadStatementAction(input.company, {
          accountId: account.id,
          settings,
          lines,
          closingBalance: read.closingBalance,
        });
        if (!result.ok) {
          throw new ApiError(
            422,
            "invalid_request",
            `${result.message ?? "The statement couldn't be saved."}${i ? ` The first ${i} rows were saved; sending the file again carries on without duplicates.` : ""}`,
          );
        }
        total.posted += result.summary.posted;
        total.duplicates += result.summary.duplicates;
        total.flagged += result.summary.flagged;
        total.categorized += result.summary.categorized;
        total.skipped += result.summary.skipped.length;
      }
      return {
        dryRun: false,
        rows: read.lines.length,
        firstDate: read.firstDate,
        lastDate: read.lastDate,
        problems: read.problems.slice(0, 50),
        ...total,
      };
    },
  }),

  defineOperation({
    name: "upload_receipt",
    title: "Upload a receipt or document",
    description: `Stores a receipt, invoice or other file (PDF or image, up to ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB; about 3 MB through the API) in Receipts, and attaches it to a transaction when \`transactionId\` is given. Send the file base64-encoded.`,
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/receipts",
    input: z.object({
      company,
      fileName: z.string().trim().min(1).max(255),
      contentType: z.string().max(100).describe("e.g. application/pdf, image/jpeg."),
      contentBase64: z.string().min(1).max(4_200_000),
      transactionId: z.uuid().optional().describe("Attach it to this transaction."),
    }),
    run: async ({ input, origin }) => {
      await getAccountingContext(input.company);
      const bytes = Buffer.from(input.contentBase64, "base64");
      if (!bytes.length) throw new ApiError(400, "invalid_request", "The file is empty.");
      const target = unwrap(
        await requestUploadAction(input.company, {
          fileName: input.fileName,
          contentType: input.contentType,
          size: bytes.length,
        }),
      ).data;
      const put = await fetch(new URL(target.url, origin), {
        method: "PUT",
        headers: target.headers,
        body: bytes,
      });
      if (!put.ok) throw new Error(`Storage refused the upload (${put.status})`);
      const file = unwrap(await completeUploadAction(input.company, target.id)).data;
      if (input.transactionId) {
        unwrap(await attachToEntryAction(input.company, input.transactionId, [file.id]));
      }
      return {
        id: file.id,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        attachedTo: input.transactionId ?? null,
      };
    },
  }),

  defineOperation({
    name: "list_transaction_files",
    title: "Files on a transaction",
    description: "The receipts and files attached to one transaction.",
    access: "read",
    http: "GET /companies/{company}/transactions/{transactionId}/files",
    input: z.object({ company, transactionId: id("transaction") }),
    run: async ({ input, origin }) =>
      (await entryAttachmentsAction(input.company, input.transactionId)).map((f) => ({
        ...f,
        url: new URL(f.url, origin).toString(),
      })),
  }),
];
