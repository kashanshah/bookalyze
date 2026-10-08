"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * What a page shows when something breaks on the server. The reference is Next's digest: the
 * same value is logged with the error ("request.failed" in the server logs), so quoting it
 * finds the cause.
 */
export function ErrorScreen({
  error,
  reset,
  compact = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={
        compact
          ? "fade-in-0 mx-auto grid max-w-md animate-in justify-items-center gap-5 px-4 py-16 text-center"
          : "fade-in-0 flex min-h-dvh animate-in flex-col items-center justify-center gap-5 px-4 text-center"
      }
    >
      <div>
        <h1 className="font-semibold text-xl">Something went wrong</h1>
        <p className="mt-1 max-w-md text-muted-foreground text-sm">
          This page couldn't load. Try again; if it keeps happening, send us the error reference
          below so we can find what happened.
        </p>
      </div>
      {error.digest ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-1.5 font-mono text-muted-foreground text-xs">
          Error reference: <span className="select-all text-foreground">{error.digest}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Go to Bookalyze</Link>
        </Button>
      </div>
    </div>
  );
}
