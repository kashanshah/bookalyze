import "server-only";
import { createHash } from "node:crypto";
import { PASSWORD_MESSAGES, passwordError } from "@bookalyze/core";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { env } from "./env";
import { logWarn } from "./log";

/**
 * Bookalyze's password rules (core `passwordProblems`, docs/SECURITY.md §2) enforced on the server
 * wherever a password is chosen: sign-up, reset, change, and adding one to a Google account. On top
 * of the shared rules, the password is checked against Have I Been Pwned's breach corpus by
 * k-anonymity: only the first five characters of its SHA-1 hash leave the server. If that service
 * can't be reached, the password is accepted (and the miss logged), so an outage elsewhere never
 * locks people out.
 */

const BREACH_API = "https://api.pwnedpasswords.com/range/";

/** Whether the password appears in a known breach (false when the check couldn't run). */
export async function isPasswordBreached(password: string): Promise<boolean> {
  if (env().PASSWORD_BREACH_CHECK === "off") return false;
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const response = await fetch(`${BREACH_API}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "Bookalyze password check" },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      logWarn("password.breach_check_unavailable", { status: response.status });
      return false;
    }
    for (const line of (await response.text()).split(/\r?\n/)) {
      const [candidate, count] = line.split(":");
      if (candidate === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch (error) {
    logWarn("password.breach_check_unavailable", {}, error);
    return false;
  }
}

/** The plain-words reason a password can't be used, or null when it's fine. */
export async function passwordRefusal(
  password: string,
  context: { email?: string | null; name?: string | null } = {},
): Promise<string | null> {
  const problem = passwordError(password, context);
  if (problem) return problem;
  return (await isPasswordBreached(password)) ? PASSWORD_MESSAGES.breached : null;
}

/** Better Auth's endpoints that set a password, and the body field that carries it. */
const PASSWORD_FIELDS: Record<string, "password" | "newPassword"> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
  "/set-password": "newPassword",
};

/** Runs before every Better Auth endpoint; refuses a new password that breaks the rules. */
export const passwordPolicyHook = createAuthMiddleware(async (ctx) => {
  const field = PASSWORD_FIELDS[ctx.path];
  if (!field) return;
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const password = body[field];
  if (typeof password !== "string") return;
  let context: { email?: string | null; name?: string | null } = {
    email: typeof body.email === "string" ? body.email : null,
    name: typeof body.name === "string" ? body.name : null,
  };
  if (ctx.path === "/change-password" || ctx.path === "/set-password") {
    const session = await getSessionFromCtx(ctx).catch(() => null);
    if (session) context = { email: session.user.email, name: session.user.name };
  }
  const refusal = await passwordRefusal(password, context);
  if (refusal) throw new APIError("BAD_REQUEST", { message: refusal });
});
