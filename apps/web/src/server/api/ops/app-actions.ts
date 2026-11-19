import "server-only";
import { z } from "zod";
import { ACTION_CATALOG, type CatalogAction } from "../action-catalog.generated";
import { type Access, ApiError, companyFor, defineOperation, requireAccess, unwrap } from "../core";
import { company } from "./shared";

/**
 * Everything else the app's screens can do, through the same server actions the browser calls
 * (see scripts/gen-action-catalog.mjs). Each action checks its own input, the person's role and
 * the company's rules, exactly as when a screen calls it. Only the ones below only read; every
 * other action needs a read-and-write key.
 */
const READ_ONLY = new Set([
  "suggestRateAction",
  "findTransactionsAction",
  "entryAttachmentsAction",
  "existingEntriesAction",
  "countMatchesAction",
  "previewAmountFixAction",
  "paymentCandidatesAction",
  "estimatePriceAction",
  "loadInvoiceDraftAction",
  "walmartSettlementDatesAction",
]);

export function actionAccess(action: Pick<CatalogAction, "name">): Access {
  return READ_ONLY.has(action.name) ? "read" : "write";
}

function describe(action: CatalogAction) {
  return {
    name: action.name,
    area: action.area,
    module: action.module,
    access: actionAccess(action),
    args: action.params,
    description: action.doc || null,
  };
}

export const appActionOperations = [
  defineOperation({
    name: "list_app_actions",
    title: "List every app action",
    description: [
      "Everything the Bookalyze screens can do that has no dedicated tool: Amazon, Noon, eBay and Walmart (connect, sync orders and settlements, post them to the books, match payouts), bank rules, duplicates, imports, sales tax setup, inventory (products, SKUs, stock, cost of goods sold, purchase orders, prices), review requests, and company records.",
      "Each has a name, its area, whether it needs a read-and-write key, its arguments (after the company) as written in the app's code, and what it does. Call one with call_app_action. Filter with `area` (e.g. commerce/settlements) or `search`.",
    ].join(" "),
    access: "read",
    http: "GET /actions",
    input: z.object({
      area: z.string().max(100).optional(),
      search: z.string().max(100).optional(),
    }),
    run: async ({ input }) => {
      const search = input.search?.toLowerCase();
      return ACTION_CATALOG.filter((a) => (input.area ? a.area.startsWith(input.area) : true))
        .filter((a) =>
          search ? `${a.name} ${a.area} ${a.doc}`.toLowerCase().includes(search) : true,
        )
        .map(describe);
    },
  }),

  defineOperation({
    name: "call_app_action",
    title: "Call an app action",
    description: [
      "Runs one action from list_app_actions for a company, exactly as the screen that offers it would: `args` are its arguments after the company, in order, as JSON (objects as the screen's form sends them).",
      "Validation errors come back as 422 with the same messages the screen shows. Prefer the dedicated tools (transactions, journal entries, reconciliation, reports, statements, purchase orders) when one fits.",
    ].join(" "),
    access: "read",
    http: "POST /companies/{company}/actions/{action}",
    input: z.object({
      company,
      action: z.string().max(100).describe("The action's name from list_app_actions."),
      args: z.array(z.unknown()).max(10).default([]),
    }),
    run: async ({ principal, input }) => {
      const action = ACTION_CATALOG.find((a) => a.name === input.action);
      if (!action) {
        throw new ApiError(
          404,
          "not_found",
          `No action named ${input.action}. See list_app_actions for the names.`,
        );
      }
      const access = actionAccess(action);
      requireAccess(principal, access);
      await companyFor(input.company, { access, module: action.module });
      if (input.args.length > action.params.length) {
        throw new ApiError(
          400,
          "invalid_request",
          `${action.name} takes ${action.params.length} argument(s) after the company: ${action.params.join(", ") || "none"}.`,
        );
      }
      return unwrap(await action.fn(input.company, ...input.args)) ?? null;
    },
  }),
];
