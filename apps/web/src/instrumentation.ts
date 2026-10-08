import type { Instrumentation } from "next";

/**
 * Every error Next.js catches on the server (pages, server actions, route handlers) is logged
 * once, as JSON, with the route and Next's digest. The error page shows the same digest as the
 * "error reference", so a screenshot leads straight to the log line.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // The browser left before the page finished (a cancelled prefetch, a quick click away): not
  // a failure, and common enough to bury real ones.
  if (error instanceof Error && error.message === "The destination stream closed early.") return;
  const { logError } = await import("./server/log");
  logError("request.failed", error, {
    // The path only: query strings and headers (cookies) stay out of the logs.
    path: request.path.split("?")[0],
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: "renderSource" in context ? context.renderSource : undefined,
  });
};
