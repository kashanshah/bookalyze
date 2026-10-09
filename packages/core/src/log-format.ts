/**
 * Shaping data for server logs (apps/web `server/log.ts` writes them): errors as plain data with
 * their cause chain, and anything that looks like a credential or personal data taken out.
 * Pure, so it's tested here.
 */

const SECRET_KEY =
  /secret|token|password|passwd|private|cookie|authori[sz]ation|refresh|api[-_]?key|credential|key[-_]?file|sealed|signature/i;
const MAX_STRING = 2000;
const MAX_STACK_LINES = 12;

/** Removes what looks like a credential from free text (an error message, a response body). */
export function scrub(text: string): string {
  return (
    text
      .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?(-----END [A-Z ]+-----|$)/g, "[pem]")
      .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, "$1 [redacted]")
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
      .replace(/\b(Atz[ar]\|)[\w|+/=-]+/g, "$1[redacted]")
      // An email: the domain ends in a real top-level domain, so "next@16.3.8" in a path isn't one.
      .replace(/\b([\w.+-])[\w.+-]*@((?:[\w-]+\.)+[A-Za-z]{2,})\b/g, "$1…@$2")
      .slice(0, MAX_STRING)
  );
}

/** A value fit for a log line: secret-sounding keys replaced, strings scrubbed, depth capped. */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrub(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return describeError(value, depth);
  if (depth > 4) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactForLog(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactForLog(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** An error as plain data: name, message, the fields our error classes carry, cause, stack. */
export function describeError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: scrub(String(error)) };
  const extra: Record<string, unknown> = {};
  // Our error classes (AmazonError, NoonError, LedgerError…) and Postgres errors keep a code;
  // some keep more (status, hint, the constraint). Copy the simple ones.
  for (const key of ["code", "status", "hint", "constraint", "detail", "digest", "table"]) {
    const v = (error as unknown as Record<string, unknown>)[key];
    if (typeof v === "string" || typeof v === "number") extra[key] = redactForLog(v);
  }
  const cause = (error as { cause?: unknown }).cause;
  return {
    name: error.name,
    message: scrub(error.message),
    ...extra,
    ...(cause !== undefined && depth < 3 ? { cause: describeError(cause, depth + 1) } : {}),
    stack: error.stack
      ? scrub(error.stack.split("\n").slice(1, MAX_STACK_LINES).join("\n"))
      : undefined,
  };
}
