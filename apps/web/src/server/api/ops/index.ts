import "server-only";
import type { Operation } from "../core";
import { accountingOperations } from "./accounting";
import { appActionOperations } from "./app-actions";
import { bankingOperations } from "./banking";
import { companyOperations } from "./companies";
import { purchasingOperations } from "./purchasing";
import { reportOperations } from "./reports";

/** Every operation of the public API, in the order the docs and MCP list them. */
export const OPERATIONS: Operation[] = [
  ...companyOperations,
  ...accountingOperations,
  ...reportOperations,
  ...bankingOperations,
  ...purchasingOperations,
  ...appActionOperations,
];
