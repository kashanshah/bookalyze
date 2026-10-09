import "server-only";
import type { BankTransaction } from "@bookalyze/core";
import {
  parseWiseBalances,
  parseWiseProfiles,
  parseWiseStatement,
  WISE_API,
  type WiseBalance,
  type WiseProfile,
} from "@bookalyze/core";
import { env } from "./env";
import { logError, logWarn, requestIdOf } from "./log";

/**
 * The Wise API, with a personal API token (read-only is enough). Responses are parsed in
 * @bookalyze/core; this file only talks HTTP and turns failures into plain-language errors.
 */

export class WiseError extends Error {
  constructor(
    message: string,
    readonly code: "unauthorized" | "sca_required" | "unavailable" | "unexpected",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "WiseError";
  }
}

const base = () => env().WISE_API_URL ?? WISE_API;

async function call(token: string, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    logError("wise.unreachable", cause, { path: path.split("?")[0] });
    throw new WiseError("Wise couldn't be reached. Try again in a minute.", "unavailable", {
      cause,
    });
  }
  if (!response.ok) {
    // The token stays in the request header; the path (with its query, which holds dates and
    // IDs only) and Wise's request ID are enough to trace it.
    logWarn("wise.request_failed", {
      path,
      status: response.status,
      requestId: requestIdOf(response),
      scaRequired: Boolean(response.headers.get("x-2fa-approval")),
    });
  }
  if (response.status === 401) {
    throw new WiseError(
      "Wise didn't accept this API token. Check it was copied in full and hasn't been revoked.",
      "unauthorized",
    );
  }
  if (response.status === 403 && response.headers.get("x-2fa-approval")) {
    throw new WiseError(
      "Wise asks for an extra security step (strong customer authentication) to read statements for this profile's region. Support for it is coming next; until then, upload a statement file instead.",
      "sca_required",
    );
  }
  if (response.status === 403) {
    throw new WiseError(
      "Wise refused access. Make sure the token's permission includes reading balances and statements.",
      "unauthorized",
    );
  }
  if (response.status >= 500 || response.status === 429) {
    throw new WiseError(
      "Wise is busy or having trouble. We'll try again on the next sync.",
      "unavailable",
    );
  }
  if (!response.ok) {
    throw new WiseError(`Wise answered with an error (${response.status}).`, "unexpected");
  }
  return response.json();
}

export async function wiseProfiles(token: string): Promise<WiseProfile[]> {
  try {
    return parseWiseProfiles(await call(token, "/v2/profiles"));
  } catch (error) {
    // Older accounts answer only the first version of this endpoint.
    if (error instanceof WiseError && error.code === "unexpected") {
      return parseWiseProfiles(await call(token, "/v1/profiles"));
    }
    throw error;
  }
}

export async function wiseBalances(token: string, profileId: number): Promise<WiseBalance[]> {
  return parseWiseBalances(await call(token, `/v4/profiles/${profileId}/balances?types=STANDARD`));
}

/** One balance's transactions between two instants (Wise allows up to about 15 months per call). */
export async function wiseStatement(
  token: string,
  input: {
    profileId: number;
    balanceId: number;
    currency: string;
    start: Date;
    end: Date;
    timeZone: string;
  },
): Promise<BankTransaction[]> {
  const query = new URLSearchParams({
    currency: input.currency,
    intervalStart: input.start.toISOString(),
    intervalEnd: input.end.toISOString(),
    type: "COMPACT",
  });
  const json = await call(
    token,
    `/v1/profiles/${input.profileId}/balance-statements/${input.balanceId}/statement.json?${query}`,
  );
  return parseWiseStatement(json, input.balanceId, input.timeZone);
}
