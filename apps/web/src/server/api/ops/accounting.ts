import "server-only";
import { ACCOUNT_TYPES, isMoneyAccountSubtype, naturalAmount } from "@bookalyze/core";
import {
  accountBalances,
  formatEntryNumber,
  getContact,
  listAttachmentsFor,
  listContacts,
  listReconcilableAccounts,
  listTransactions,
  moneyAccountBalances,
  reconciliationHistory,
  reconciliationState,
  schema,
  TRANSACTION_STATUSES,
} from "@bookalyze/db";
import { and, count, desc, eq, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  postJournalEntryAction,
  reverseJournalEntryAction,
  saveAccountAction,
  setAccountArchivedAction,
  suggestRateAction,
} from "@/app/o/[slug]/accounting/actions";
import {
  saveContactAction,
  setContactArchivedAction,
} from "@/app/o/[slug]/accounting/contacts/actions";
import {
  cancelReconciliationAction,
  completeReconciliationAction,
  setClearedAction,
  startReconciliationAction,
  undoReconciliationAction,
  updateStatementAction,
} from "@/app/o/[slug]/accounting/reconcile/actions";
import {
  deleteTransactionAction,
  matchTransferAction,
  saveTransactionAction,
  setReviewedAction,
  unmatchTransferAction,
} from "@/app/o/[slug]/accounting/transactions/actions";
import { rowInput } from "@/app/o/[slug]/accounting/transactions/row-input";
import type { TxRow } from "@/app/o/[slug]/accounting/transactions/types";
import { getAccountingContext, inOrg, listAccounts } from "@/server/accounting";
import { ApiError, defineOperation, notFoundError, unwrap } from "../core";
import { amount, boolish, company, id, isoDate, page, transactionOut } from "./shared";

const split = z.object({
  accountId: z.uuid().describe("The category account (income, expense, equity, liability…)."),
  amount: amount("This part's amount, positive, in the money account's currency."),
  description: z.string().max(200).optional(),
  taxRateId: z
    .uuid()
    .optional()
    .describe("Sales tax included in this amount, from list_tax_rates."),
});

const transactionFields = {
  date: isoDate("The transaction's date."),
  memo: z.string().max(500).optional().describe("The description, e.g. the bank's text."),
  fxRate: z
    .string()
    .max(30)
    .optional()
    .describe(
      "For a money account in another currency: main-currency units per one unit of it (see suggest_exchange_rate).",
    ),
  contactId: z.uuid().optional().describe("The customer (money in) or vendor (money out)."),
};

async function findTransaction(slug: string, entryId: string) {
  const ctx = await getAccountingContext(slug);
  const { rows } = await inOrg(ctx, (tx) =>
    listTransactions(tx, { entryIds: [entryId], limit: 1, offset: 0 }),
  );
  const row = rows[0];
  if (!row) throw notFoundError("transaction");
  return { ctx, row };
}

export const accountingOperations = [
  // --- Chart of accounts --------------------------------------------------------------------
  defineOperation({
    name: "list_accounts",
    title: "Chart of accounts",
    description:
      "The chart of accounts with each account's type, subtype, currency, system key and balance in the main currency (as of `asOf`, default today). Use it to find category IDs: income, expenses, owner contributions and drawings (subtype owner_equity, e.g. 3000 Owner contributions and 3100 Owner drawings and dividends), money owed to owners (subtype due_to_owners), loans, and bank, card and cash accounts (subtypes cash_bank, credit_card, money_in_transit).",
    access: "read",
    http: "GET /companies/{company}/accounts",
    input: z.object({
      company,
      type: z.enum(ACCOUNT_TYPES).optional().describe("Only this type."),
      includeArchived: boolish.optional(),
      asOf: isoDate("Balances as of this day (default: all entries).").optional(),
    }),
    run: async ({ input }) => {
      const ctx = await getAccountingContext(input.company);
      const accounts = await listAccounts(ctx);
      const balances = await inOrg(ctx, (tx) => accountBalances(tx, { to: input.asOf }));
      const byId = new Map(balances.map((b) => [b.accountId, b.balance]));
      return accounts
        .filter((a) => (input.includeArchived ? true : !a.isArchived))
        .filter((a) => (input.type ? a.type === input.type : true))
        .map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          subtype: a.subtype,
          systemKey: a.systemKey,
          currency: a.currency ?? ctx.profile.baseCurrency,
          description: a.description,
          isArchived: a.isArchived,
          isMoneyAccount: isMoneyAccountSubtype(a.subtype),
          /** In the main currency, as the account normally reads (assets positive, etc.). */
          balance: naturalAmount(a.type, byId.get(a.id) ?? "0"),
        }));
    },
  }),

  defineOperation({
    name: "create_account",
    title: "Add an account",
    description:
      "Adds an account to the chart of accounts (a category or a bank, card or cash account). Bank and card accounts need a currency. Same rules as Accounting → Chart of accounts.",
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/accounts",
    input: z.object({
      company,
      name: z.string().max(120),
      code: z.string().max(20).optional(),
      type: z.enum(ACCOUNT_TYPES),
      subtype: z.string().max(60).describe("What it's for, e.g. cash_bank, operating_expense."),
      description: z.string().max(300).optional(),
      currency: z.string().length(3).optional(),
    }),
    run: async ({ input: { company: slug, ...value } }) =>
      unwrap(await saveAccountAction(slug, value)).data,
  }),

  defineOperation({
    name: "update_account",
    title: "Change an account",
    description:
      "Renames or recodes an account, or changes its subtype, description or currency. Its type can't change once it has entries, and system accounts keep their type.",
    access: "write",
    module: "accounting",
    http: "PATCH /companies/{company}/accounts/{accountId}",
    input: z.object({
      company,
      accountId: id("account"),
      name: z.string().max(120).optional(),
      code: z.string().max(20).nullable().optional(),
      subtype: z.string().max(60).optional(),
      description: z.string().max(300).nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
      archived: z.boolean().optional().describe("Archive (true) or restore (false)."),
    }),
    run: async ({ input }) => {
      const ctx = await getAccountingContext(input.company);
      const existing = (await listAccounts(ctx)).find((a) => a.id === input.accountId);
      if (!existing) throw notFoundError("account");
      const changesFields = ["name", "code", "subtype", "description", "currency"].some(
        (k) => input[k as keyof typeof input] !== undefined,
      );
      if (changesFields) {
        unwrap(
          await saveAccountAction(input.company, {
            id: existing.id,
            name: input.name ?? existing.name,
            code: (input.code === undefined ? existing.code : input.code) ?? "",
            type: existing.type,
            subtype: input.subtype ?? existing.subtype,
            description:
              (input.description === undefined ? existing.description : input.description) ?? "",
            currency: (input.currency === undefined ? existing.currency : input.currency) ?? "",
          }),
        );
      }
      if (input.archived !== undefined) {
        unwrap(await setAccountArchivedAction(input.company, existing.id, input.archived));
      }
      return { id: existing.id };
    },
  }),

  // --- Transactions -------------------------------------------------------------------------
  defineOperation({
    name: "list_transactions",
    title: "List transactions",
    description:
      "Transactions (money in, money out, transfers) as on Accounting → Transactions, newest first, with their categories (splits), reviewed tick and reconciliation date. Filter by bank account, category, contact, kind, status, dates or text. Amounts are positive; `kind` says the direction.",
    access: "read",
    http: "GET /companies/{company}/transactions",
    input: z.object({
      company,
      accountId: z.uuid().optional().describe("Only this bank, card or cash account."),
      categoryId: z.uuid().optional().describe("Only with a split in this category."),
      contactId: z.uuid().optional(),
      kind: z.enum(["deposit", "withdrawal", "transfer"]).optional(),
      status: z
        .enum(TRANSACTION_STATUSES)
        .optional()
        .describe("unreviewed, reviewed, duplicates (possible copies) or no_account."),
      from: isoDate("On or after this day.").optional(),
      to: isoDate("On or before this day.").optional(),
      search: z.string().max(100).optional().describe("Text in the description or reference."),
      ...page,
    }),
    run: async ({ input }) => {
      const ctx = await getAccountingContext(input.company);
      const result = await inOrg(ctx, (tx) =>
        listTransactions(tx, {
          accountId: input.accountId,
          categoryId: input.categoryId,
          contactId: input.contactId,
          kind: input.kind,
          statuses: input.status && input.status !== "transfers" ? [input.status] : undefined,
          from: input.from,
          to: input.to,
          search: input.search,
          limit: input.limit,
          offset: input.offset,
        }),
      );
      return {
        total: result.total,
        limit: input.limit,
        offset: input.offset,
        transactions: result.rows.map(transactionOut),
      };
    },
  }),

  defineOperation({
    name: "get_transaction",
    title: "Get a transaction",
    description: "One transaction by ID, with its splits and attached receipts.",
    access: "read",
    http: "GET /companies/{company}/transactions/{transactionId}",
    input: z.object({ company, transactionId: id("transaction") }),
    run: async ({ input }) => {
      const { ctx, row } = await findTransaction(input.company, input.transactionId);
      const files = await inOrg(ctx, (tx) => listAttachmentsFor(tx, "journal_entry", row.id));
      return {
        ...transactionOut(row),
        files: files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
        })),
      };
    },
  }),

  defineOperation({
    name: "create_transaction",
    title: "Add a transaction",
    description: [
      "Records money in (deposit), money out (withdrawal) or a transfer between two of the company's own bank, card or cash accounts, exactly like Accounting → Transactions → Add.",
      "Deposit/withdrawal: `moneyAccountId` plus one or more `splits` (category + positive amount, in the money account's currency).",
      "Owner contribution: a deposit categorised to the owner contributions account (subtype owner_equity, usually 3000); owner drawing: a withdrawal to owner drawings (owner_equity, usually 3100). Money an owner lent or paid for the business goes to the due_to_owners liability (usually 2500). Find them with list_accounts.",
      "Transfer: `fromAccountId`, `toAccountId` and `amount` (what left). Between currencies also give `received` (what arrived, in the receiving account's currency); give `fxRate` when neither side is in the main currency.",
      "Closed periods and other rules are enforced; errors name the field to fix.",
    ].join(" "),
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/transactions",
    input: z.object({
      company,
      kind: z.enum(["deposit", "withdrawal", "transfer"]),
      ...transactionFields,
      moneyAccountId: z
        .uuid()
        .optional()
        .describe("Deposit/withdrawal: the bank/card/cash account."),
      splits: z.array(split).max(50).optional(),
      fromAccountId: z.uuid().optional().describe("Transfer: where the money left."),
      toAccountId: z.uuid().optional().describe("Transfer: where it arrived."),
      amount: amount(
        "Transfer: the amount that left, in the sending account's currency.",
      ).optional(),
      received: amount(
        "Transfer between currencies: what arrived, in the receiving account's currency.",
      ).optional(),
      attachmentIds: z.array(z.uuid()).max(50).optional().describe("Receipts from upload_receipt."),
    }),
    run: async ({ input: { company: slug, ...value } }) =>
      unwrap(
        await saveTransactionAction(slug, {
          ...value,
          splits: value.splits?.map((s) => ({
            accountId: s.accountId,
            amount: s.amount,
            description: s.description ?? "",
            taxRateId: s.taxRateId ?? "",
          })),
        }),
      ).data,
  }),

  defineOperation({
    name: "update_transaction",
    title: "Change a transaction (categorise)",
    description: [
      "Changes a transaction the way editing it on the Transactions screen does: the category (`categoryId` for a one-category transaction, or `splits` to replace all of them), description, contact, date, amount or bank account.",
      "Use it to categorise bank transactions. Reconciled transactions keep their date, amount and bank account (the statement's fields) but can be recategorised.",
      "Transactions in a closed period can't change. The edit reverses the old entry and posts a corrected one; the ID changes (returned).",
    ].join(" "),
    access: "write",
    module: "accounting",
    http: "PATCH /companies/{company}/transactions/{transactionId}",
    input: z.object({
      company,
      transactionId: id("transaction"),
      date: isoDate("A new date.").optional(),
      memo: z.string().max(500).optional(),
      amount: amount("A new amount (single-category transactions and transfers).").optional(),
      moneyAccountId: z.uuid().optional(),
      categoryId: z.uuid().optional().describe("The category, for a one-category transaction."),
      splits: z.array(split).min(1).max(50).optional().describe("Replace all categories."),
      contactId: z.uuid().nullable().optional().describe("null removes the contact."),
      fxRate: z.string().max(30).optional(),
      received: amount("Transfers between currencies: what arrived.").optional(),
    }),
    run: async ({ input }) => {
      const { ctx, row } = await findTransaction(input.company, input.transactionId);
      if (input.categoryId && !input.splits && row.view.splits.length > 1) {
        throw new ApiError(
          422,
          "invalid_request",
          `This transaction has ${row.view.splits.length} categories. Send \`splits\` with all of them instead of \`categoryId\`.`,
        );
      }
      const txRow = {
        id: row.id,
        date: row.date,
        memo: row.memo,
        currency: row.currency,
        fxRate: row.fxRate,
        contactId: row.contactId,
        kind: row.view.kind,
        amount: row.view.amount,
        moneyAccountIds: row.view.moneyAccountIds,
        fromAccountId: row.view.fromAccountId,
        toAccountId: row.view.toAccountId,
        receivedAmount: row.view.receivedAmount,
        receivedCurrency: row.view.receivedCurrency,
        needsAccount: row.view.needsAccount,
        splits: row.view.splits.map((s) => ({
          accountId: s.accountId,
          amount: s.amount,
          description: s.description ?? undefined,
          taxRateId: s.taxRateId ?? undefined,
        })),
      } as TxRow;
      const form = rowInput(txRow, ctx.profile.baseCurrency, {
        date: input.date,
        memo: input.memo,
        amount: input.amount,
        moneyAccountId: input.moneyAccountId,
        categoryId: input.categoryId,
      });
      if (input.splits) {
        form.splits = input.splits.map((s) => ({
          accountId: s.accountId,
          amount: s.amount,
          description: s.description ?? "",
          taxRateId: s.taxRateId ?? "",
        }));
      }
      if (input.contactId !== undefined) form.contactId = input.contactId ?? "";
      if (input.fxRate !== undefined) form.fxRate = input.fxRate;
      if (input.received !== undefined) form.received = input.received;
      return unwrap(await saveTransactionAction(input.company, form)).data;
    },
  }),

  defineOperation({
    name: "delete_transaction",
    title: "Remove a transaction",
    description:
      "Removes a transaction (reverses it; the journal keeps both). Refused for reconciled transactions and closed periods.",
    access: "write",
    module: "accounting",
    destructive: true,
    http: "DELETE /companies/{company}/transactions/{transactionId}",
    input: z.object({ company, transactionId: id("transaction") }),
    run: async ({ input }) => {
      unwrap(await deleteTransactionAction(input.company, input.transactionId));
      return { removed: input.transactionId };
    },
  }),

  defineOperation({
    name: "set_transaction_reviewed",
    title: "Tick a transaction as reviewed",
    description: "Ticks (or unticks) a transaction as reviewed, as on the Transactions screen.",
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/transactions/{transactionId}/reviewed",
    input: z.object({ company, transactionId: id("transaction"), reviewed: z.boolean() }),
    run: async ({ input }) => {
      unwrap(await setReviewedAction(input.company, input.transactionId, input.reviewed));
      return { id: input.transactionId, reviewed: input.reviewed };
    },
  }),

  defineOperation({
    name: "match_transfer",
    title: "Match two transactions as a transfer",
    description:
      "Turns money out of one of the company's accounts and money in to another (e.g. both sides of a bank-to-card payment, each imported from its own statement) into one transfer, as Transactions → Match does. Give `outId` and `inId`, or `entryIds` for a hand-picked pair.",
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/transfers/match",
    input: z.object({
      company,
      outId: z.uuid().optional(),
      inId: z.uuid().optional(),
      entryIds: z.array(z.uuid()).min(2).max(2).optional(),
    }),
    run: async ({ input }) => {
      const pair =
        input.outId && input.inId
          ? { outId: input.outId, inId: input.inId }
          : input.entryIds
            ? { entryIds: input.entryIds }
            : null;
      if (!pair) throw new ApiError(400, "invalid_request", "Give outId and inId, or entryIds.");
      unwrap(await matchTransferAction(input.company, pair));
      return { matched: true };
    },
  }),

  defineOperation({
    name: "unmatch_transfer",
    title: "Unmatch a transfer",
    description: "Splits a matched transfer back into its two bank transactions.",
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/transactions/{transactionId}/unmatch-transfer",
    input: z.object({ company, transactionId: id("transaction") }),
    run: async ({ input }) => {
      unwrap(await unmatchTransferAction(input.company, input.transactionId));
      return { unmatched: true };
    },
  }),

  // --- Journal entries ----------------------------------------------------------------------
  defineOperation({
    name: "list_journal_entries",
    title: "List journal entries",
    description:
      "Journal entries (every posting, including reversals) newest first, each with its lines. Amounts on lines are signed: positive is a debit, negative a credit.",
    access: "read",
    http: "GET /companies/{company}/journal-entries",
    input: z.object({
      company,
      from: isoDate("On or after this day.").optional(),
      to: isoDate("On or before this day.").optional(),
      search: z.string().max(100).optional().describe("Text in the memo or reference."),
      ...page,
    }),
    run: async ({ input }) => {
      const ctx = await getAccountingContext(input.company);
      return inOrg(ctx, async (tx) => {
        const je = schema.journalEntries;
        const where: SQL[] = [];
        if (input.from) where.push(gte(je.date, input.from));
        if (input.to) where.push(lte(je.date, input.to));
        if (input.search) {
          const pattern = `%${input.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
          const match = or(ilike(je.memo, pattern), ilike(je.reference, pattern));
          if (match) where.push(match);
        }
        const condition = where.length ? and(...where) : undefined;
        const [total] = await tx.select({ n: count() }).from(je).where(condition);
        const entries = await tx
          .select()
          .from(je)
          .where(condition)
          .orderBy(desc(je.date), desc(je.entryNumber))
          .limit(input.limit)
          .offset(input.offset);
        const lines = entries.length
          ? await tx
              .select({ line: schema.journalLines, accountName: schema.accounts.name })
              .from(schema.journalLines)
              .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
              .where(
                inArray(
                  schema.journalLines.journalEntryId,
                  entries.map((e) => e.id),
                ),
              )
              .orderBy(schema.journalLines.lineNo)
          : [];
        return {
          total: total?.n ?? 0,
          limit: input.limit,
          offset: input.offset,
          entries: entries.map((e) => ({
            ...entryOut(e),
            lines: lines.filter((l) => l.line.journalEntryId === e.id).map(lineOut),
          })),
        };
      });
    },
  }),

  defineOperation({
    name: "get_journal_entry",
    title: "Get a journal entry",
    description:
      "One journal entry with its lines, contact, attached files and what reversed it (or what it reverses).",
    access: "read",
    http: "GET /companies/{company}/journal-entries/{entryId}",
    input: z.object({ company, entryId: id("journal entry") }),
    run: async ({ input }) => {
      const ctx = await getAccountingContext(input.company);
      const result = await inOrg(ctx, async (tx) => {
        const [entry] = await tx
          .select()
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.id, input.entryId));
        if (!entry) return null;
        const lines = await tx
          .select({ line: schema.journalLines, accountName: schema.accounts.name })
          .from(schema.journalLines)
          .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
          .where(eq(schema.journalLines.journalEntryId, entry.id))
          .orderBy(schema.journalLines.lineNo);
        const files = await listAttachmentsFor(tx, "journal_entry", entry.id);
        const contact = entry.contactId ? await getContact(tx, entry.contactId) : null;
        return {
          ...entryOut(entry),
          contact: contact ? { id: contact.id, name: contact.name, type: contact.type } : null,
          lines: lines.map(lineOut),
          files: files.map((f) => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes })),
        };
      });
      if (!result) throw notFoundError("journal entry");
      return result;
    },
  }),

  defineOperation({
    name: "create_journal_entry",
    title: "Post a journal entry",
    description: [
      "Posts a manual journal entry, validated exactly like Accounting → Journal entries → New: debits must equal credits, accounts must exist and be active, and the date must be in an open period.",
      "Each line has `accountId` and either `debit` or `credit` (positive decimals). For an entry in a foreign currency give `currency` and `fxRate` (main-currency units per one unit).",
      "Prefer create_transaction for anything that moves money through a bank, card or cash account; use journal entries for accruals, adjustments, opening balances and non-cash items.",
    ].join(" "),
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/journal-entries",
    input: z.object({
      company,
      date: isoDate("The entry's date."),
      memo: z.string().max(500).optional(),
      reference: z.string().max(60).optional(),
      currency: z.string().length(3).optional().describe("Default: the main currency."),
      fxRate: z.string().max(30).optional(),
      lines: z
        .array(
          z.object({
            accountId: z.uuid(),
            description: z.string().max(200).optional(),
            debit: amount("Debit amount.").optional(),
            credit: amount("Credit amount.").optional(),
          }),
        )
        .min(2)
        .max(200),
    }),
    run: async ({ input: { company: slug, ...value } }) => {
      const ctx = await getAccountingContext(slug);
      return unwrap(
        await postJournalEntryAction(slug, {
          ...value,
          currency: value.currency ?? ctx.profile.baseCurrency,
        }),
      ).data;
    },
  }),

  defineOperation({
    name: "reverse_journal_entry",
    title: "Reverse a journal entry",
    description:
      "Posts the opposite of an entry on `date` (in an open period), which is how posted entries are corrected. Refused for reconciled entries.",
    access: "write",
    module: "accounting",
    destructive: true,
    http: "POST /companies/{company}/journal-entries/{entryId}/reverse",
    input: z.object({
      company,
      entryId: id("journal entry"),
      date: isoDate("The reversal's date."),
    }),
    run: async ({ input }) =>
      unwrap(await reverseJournalEntryAction(input.company, input.entryId, input.date)).data,
  }),

  defineOperation({
    name: "suggest_exchange_rate",
    title: "Suggest an exchange rate",
    description:
      "The published rate for `currency` on `date` in the company's main currency (main-currency units per one unit), as the forms suggest it. Null when none is published.",
    access: "read",
    http: "GET /companies/{company}/exchange-rates",
    input: z.object({
      company,
      currency: z.string().length(3).toUpperCase(),
      date: isoDate("The day."),
    }),
    run: async ({ input }) => suggestRateAction(input.company, input.currency, input.date),
  }),

  // --- Customers and vendors ----------------------------------------------------------------
  defineOperation({
    name: "list_contacts",
    title: "List customers and vendors",
    description:
      "Customers and vendors (suppliers) with what was received from and paid to each. Filter by type or name.",
    access: "read",
    http: "GET /companies/{company}/contacts",
    input: z.object({
      company,
      type: z.enum(["customer", "vendor"]).optional(),
      search: z.string().max(100).optional(),
      archived: boolish.optional(),
    }),
    run: async ({ input }) => {
      const ctx = await getAccountingContext(input.company);
      const rows = await inOrg(ctx, (tx) =>
        listContacts(tx, { type: input.type, search: input.search, archived: input.archived }),
      );
      return rows.map((c) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        email: c.email,
        phone: c.phone,
        taxNumber: c.taxNumber,
        isArchived: c.isArchived,
        received: c.received,
        paid: c.paid,
        transactions: c.transactions,
      }));
    },
  }),

  defineOperation({
    name: "save_contact",
    title: "Add or change a customer or vendor",
    description:
      "Adds a customer or vendor, or changes one when `contactId` is given. `archived` archives or restores it.",
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/contacts",
    input: z.object({
      company,
      contactId: z.uuid().optional(),
      type: z.enum(["customer", "vendor", "both"]),
      name: z.string().max(200),
      email: z.string().max(254).optional(),
      phone: z.string().max(50).optional(),
      taxNumber: z.string().max(50).optional(),
      address: z.string().max(500).optional(),
      notes: z.string().max(2000).optional(),
      archived: z.boolean().optional(),
    }),
    run: async ({ input: { company: slug, contactId, archived, ...value } }) => {
      const saved = unwrap(await saveContactAction(slug, { ...value, id: contactId }));
      const savedId = (saved as { data?: { id?: string } }).data?.id ?? contactId;
      if (archived !== undefined && savedId) {
        unwrap(await setContactArchivedAction(slug, savedId, archived));
      }
      return { id: savedId };
    },
  }),

  // --- Bank accounts and reconciliation -----------------------------------------------------
  defineOperation({
    name: "list_bank_accounts",
    title: "Bank, card and cash accounts",
    description:
      "Each bank, card and cash account with its balance in Bookalyze (in its own currency), the bank's own latest balance where a feed or statement reported one, the last statement it was reconciled to, and any reconciliation in progress.",
    access: "read",
    http: "GET /companies/{company}/bank-accounts",
    input: z.object({ company }),
    run: async ({ input }) => {
      const ctx = await getAccountingContext(input.company);
      return inOrg(ctx, async (tx) => {
        const accounts = await listReconcilableAccounts(tx);
        const balances = await moneyAccountBalances(tx);
        const feeds = await tx
          .select({
            accountId: schema.bankFeeds.accountId,
            bankBalance: schema.bankFeeds.bankBalance,
            bankBalanceOn: schema.bankFeeds.bankBalanceOn,
            syncedThrough: schema.bankFeeds.syncedThrough,
          })
          .from(schema.bankFeeds)
          .where(eq(schema.bankFeeds.isActive, true));
        return accounts.map((a) => {
          const ledger = balances.accounts.find((b) => b.accountId === a.id);
          const feed = feeds
            .filter((f) => f.accountId === a.id && f.bankBalanceOn)
            .sort((x, y) => String(y.bankBalanceOn).localeCompare(String(x.bankBalanceOn)))[0];
          return {
            id: a.id,
            code: a.code,
            name: a.name,
            subtype: a.subtype,
            currency: a.currency ?? ctx.profile.baseCurrency,
            /** As a statement reads it: a bank's money held, a card's amount owed. */
            balance: naturalAmount(a.type, ledger?.balance ?? "0"),
            bankBalance: feed ? { amount: feed.bankBalance, on: feed.bankBalanceOn } : null,
            lastReconciled: a.lastReconciled,
            reconciliationInProgressId: a.inProgressId,
          };
        });
      });
    },
  }),

  defineOperation({
    name: "get_reconciliation",
    title: "Reconciliation status for an account",
    description:
      "For one bank, card or cash account: the reconciliation in progress (statement date and balance, every line up to the statement date with whether it's ticked, the cleared total and the difference left) and the history of finished ones. Tick lines with set_reconciliation_cleared until the difference is zero, then finish_reconciliation.",
    access: "read",
    http: "GET /companies/{company}/bank-accounts/{accountId}/reconciliation",
    input: z.object({ company, accountId: id("bank account") }),
    run: async ({ input }) => {
      const ctx = await getAccountingContext(input.company);
      const result = await inOrg(ctx, async (tx) => {
        const [account] = await tx
          .select()
          .from(schema.accounts)
          .where(eq(schema.accounts.id, input.accountId));
        if (!account || !isMoneyAccountSubtype(account.subtype)) return null;
        const [open] = await tx
          .select({ id: schema.reconciliations.id })
          .from(schema.reconciliations)
          .where(
            and(
              eq(schema.reconciliations.accountId, account.id),
              eq(schema.reconciliations.status, "in_progress"),
            ),
          );
        return {
          account: { id: account.id, name: account.name, currency: account.currency },
          inProgress: open ? await reconciliationState(tx, open.id) : null,
          history: (await reconciliationHistory(tx, account.id)).map((r) => ({
            id: r.id,
            statementDate: r.statementDate,
            statementBalance: r.statementBalance,
            completedAt: r.completedAt,
          })),
        };
      });
      if (!result) throw notFoundError("bank account");
      return result;
    },
  }),

  defineOperation({
    name: "start_reconciliation",
    title: "Start reconciling an account",
    description:
      "Starts reconciling a bank, card or cash account to a statement: its closing date and ending balance (as the statement shows it; a card's balance owed is positive). One at a time per account.",
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/bank-accounts/{accountId}/reconciliations",
    input: z.object({
      company,
      accountId: id("bank account"),
      statementDate: isoDate("The statement's closing date."),
      statementBalance: amount("The statement's ending balance."),
    }),
    run: async ({ input }) => {
      const result = unwrap(
        await startReconciliationAction(input.company, input.accountId, {
          statementDate: input.statementDate,
          statementBalance: input.statementBalance,
        }),
      );
      return { reconciliationId: result.id };
    },
  }),

  defineOperation({
    name: "update_reconciliation_statement",
    title: "Change the statement being reconciled",
    description:
      "Changes the statement date or ending balance of a reconciliation in progress. Moving the date earlier unticks lines after it.",
    access: "write",
    module: "accounting",
    http: "PATCH /companies/{company}/reconciliations/{reconciliationId}",
    input: z.object({
      company,
      reconciliationId: id("reconciliation"),
      statementDate: isoDate("The statement's closing date."),
      statementBalance: amount("The statement's ending balance."),
    }),
    run: async ({ input }) => {
      unwrap(
        await updateStatementAction(input.company, input.reconciliationId, {
          statementDate: input.statementDate,
          statementBalance: input.statementBalance,
        }),
      );
      return { reconciliationId: input.reconciliationId };
    },
  }),

  defineOperation({
    name: "set_reconciliation_cleared",
    title: "Tick lines on the statement",
    description:
      "Ticks (cleared: true) or unticks lines of a reconciliation in progress. Line IDs are the `lineId`s from get_reconciliation.",
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/reconciliations/{reconciliationId}/cleared",
    input: z.object({
      company,
      reconciliationId: id("reconciliation"),
      lineIds: z.array(z.uuid()).min(1).max(10000),
      cleared: z.boolean(),
    }),
    run: async ({ input }) => {
      unwrap(
        await setClearedAction(input.company, input.reconciliationId, input.lineIds, input.cleared),
      );
      return { reconciliationId: input.reconciliationId, changed: input.lineIds.length };
    },
  }),

  defineOperation({
    name: "finish_reconciliation",
    title: "Finish a reconciliation",
    description:
      "Finishes a reconciliation whose difference is zero. Its ticked transactions are then locked (their date, amount and account can't change) until it's undone.",
    access: "write",
    module: "accounting",
    http: "POST /companies/{company}/reconciliations/{reconciliationId}/finish",
    input: z.object({ company, reconciliationId: id("reconciliation") }),
    run: async ({ input }) => {
      unwrap(await completeReconciliationAction(input.company, input.reconciliationId));
      return { reconciliationId: input.reconciliationId, status: "completed" };
    },
  }),

  defineOperation({
    name: "cancel_reconciliation",
    title: "Cancel a reconciliation in progress",
    description: "Throws away a reconciliation in progress and its ticks.",
    access: "write",
    module: "accounting",
    destructive: true,
    http: "POST /companies/{company}/reconciliations/{reconciliationId}/cancel",
    input: z.object({ company, reconciliationId: id("reconciliation") }),
    run: async ({ input }) => {
      unwrap(await cancelReconciliationAction(input.company, input.reconciliationId));
      return { reconciliationId: input.reconciliationId, status: "cancelled" };
    },
  }),

  defineOperation({
    name: "undo_reconciliation",
    title: "Undo a finished reconciliation",
    description:
      "Reopens the account's latest finished reconciliation (only the latest, and only while none is in progress), unlocking its transactions.",
    access: "write",
    module: "accounting",
    destructive: true,
    http: "POST /companies/{company}/reconciliations/{reconciliationId}/undo",
    input: z.object({ company, reconciliationId: id("reconciliation") }),
    run: async ({ input }) => {
      unwrap(await undoReconciliationAction(input.company, input.reconciliationId));
      return { reconciliationId: input.reconciliationId, status: "in_progress" };
    },
  }),
];

function entryOut(e: typeof schema.journalEntries.$inferSelect) {
  return {
    id: e.id,
    number: formatEntryNumber(e.entryNumber),
    date: e.date,
    memo: e.memo,
    reference: e.reference,
    currency: e.currency,
    fxRate: e.fxRate,
    source: e.source,
    contactId: e.contactId,
    reversedByEntryId: e.reversedByEntryId,
    reversesEntryId: e.reversesEntryId,
    createdAt: e.createdAt,
  };
}

function lineOut(l: { line: typeof schema.journalLines.$inferSelect; accountName: string }) {
  return {
    id: l.line.id,
    accountId: l.line.accountId,
    accountName: l.accountName,
    description: l.line.description,
    currency: l.line.currency,
    /** Signed: positive debit, negative credit. */
    amount: l.line.amount,
    baseAmount: l.line.baseAmount,
  };
}
