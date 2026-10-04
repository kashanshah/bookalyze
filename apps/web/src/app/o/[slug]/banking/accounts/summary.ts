import type { SyncSummary } from "@/server/banking";

/** A sync's outcome in words, for a toast. */
export function summaryMessage(summary: SyncSummary): {
  title: string;
  description?: string;
  tone: "success" | "error";
} {
  const parts: string[] = [];
  if (summary.posted) {
    parts.push(
      `${summary.posted} new transaction${summary.posted === 1 ? "" : "s"} to sort on the Transactions screen.`,
    );
  }
  if (summary.skipped.length) {
    const first = summary.skipped[0]?.reason ?? "";
    parts.push(`${summary.skipped.length} couldn't be added yet and will be tried again: ${first}`);
  }
  if (summary.error)
    return { title: "The sync didn't finish", description: summary.error, tone: "error" };
  if (!summary.posted && !summary.skipped.length) {
    return {
      title: "Up to date",
      description: "No new transactions since the last sync.",
      tone: "success",
    };
  }
  return { title: "Synced", description: parts.join(" "), tone: "success" };
}
