import "server-only";

/**
 * Server logs, one JSON line per event, so they're easy to search in Vercel → Logs (search for
 * the event name, a company ID or an error reference). Each line has `level`, `event` (what
 * happened, e.g. "noon.request_failed"), `time`, the error (name, message, code, status, cause
 * chain, stack) and the context given (IDs, paths, the provider's request ID).
 *
 * Never put credentials or personal data in the context. As a safety net, keys that sound secret
 * (token, secret, password, key, cookie…) are replaced, and strings are scrubbed of bearer
 * tokens, PEM blocks and JWTs. Email addresses are masked.
 */

import { describeError, redactForLog, scrub } from "@bookalyze/core";

export type LogContext = Record<string, unknown>;
type Level = "error" | "warn" | "info";

function write(level: Level, event: string, error: unknown, context: LogContext | undefined) {
  const line: Record<string, unknown> = {
    level,
    event,
    time: new Date().toISOString(),
    ...(context ? (redactForLog(context) as Record<string, unknown>) : {}),
  };
  if (error !== undefined) line.error = describeError(error);
  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    text = JSON.stringify({ level, event, time: line.time, note: "context not serializable" });
  }
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.info(text);
}

/** Something failed that someone may need to fix (a bug, a provider refusing, a job failing). */
export function logError(event: string, error: unknown, context?: LogContext) {
  write("error", event, error, context);
}

/** Something went wrong that the app handled (a refused key, a throttled call, a skipped row). */
export function logWarn(event: string, context?: LogContext, error?: unknown) {
  write("warn", event, error, context);
}

/** A notable outcome, e.g. a scheduled job's summary. */
export function logInfo(event: string, context?: LogContext) {
  write("info", event, undefined, context);
}

/** The ID a provider gives each response, to quote to its support. */
export function requestIdOf(response: Response): string | undefined {
  for (const header of ["x-request-id", "x-amzn-requestid", "x-amz-request-id", "x-trace-id"]) {
    const value = response.headers.get(header);
    if (value) return value.slice(0, 200);
  }
  return undefined;
}

/**
 * One step of a scheduled job: its failure is logged (with how long it ran) and returned as
 * `{ error }`, so the job's other steps still run.
 */
export async function jobStep<T>(
  job: string,
  step: string,
  run: () => Promise<T>,
): Promise<T | { error: string }> {
  const started = Date.now();
  try {
    return await run();
  } catch (error) {
    logError(`job.${job}.${step}_failed`, error, { job, step, ms: Date.now() - started });
    return { error: error instanceof Error ? scrub(error.message) : "failed" };
  }
}
