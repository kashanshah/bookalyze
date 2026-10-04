"use client";

import { formatMoney, mergeProblem } from "@bookalyze/core";
import { ExternalLink, GitMerge, Split, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { acceptDuplicateAction, dismissDuplicateAction, mergeTransactionsAction } from "./actions";
import type { TxFormContext, TxRow } from "./types";

const entryNo = (number: string) => Number.parseInt(number.replace(/\D/g, ""), 10) || 0;

function signedAmount(row: TxRow, locale: string) {
  const money = formatMoney(row.amount, row.currency, locale);
  return row.kind === "deposit" ? `+${money}` : row.kind === "withdrawal" ? `−${money}` : money;
}

/** Where the money is and what it was for, e.g. "RBC Chequing · Office supplies". */
function placement(row: TxRow, name: (id?: string) => string) {
  const what = category(row, name);
  return row.kind === "transfer" ? what : `${name(row.moneyAccountIds[0])} · ${what}`;
}

function category(row: TxRow, name: (id?: string) => string) {
  if (row.kind === "transfer") return `${name(row.fromAccountId)} → ${name(row.toAccountId)}`;
  return row.splits.length > 1 ? `Split (${row.splits.length})` : name(row.splits[0]?.accountId);
}

function Side({
  label,
  title,
  lines,
  amount,
  href,
  tone,
}: {
  label: string;
  title: string;
  lines: string[];
  amount: string;
  href?: string;
  tone?: "removed" | "kept";
}) {
  const body = (
    <>
      <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">{label}</p>
      <p className="mt-1.5 truncate font-medium">{title}</p>
      {lines.map((l) => (
        <p key={l} className="truncate text-muted-foreground text-sm">
          {l}
        </p>
      ))}
      <p className="tabular mt-1.5 font-semibold">{amount}</p>
    </>
  );
  const className = cn(
    "min-w-0 rounded-xl border p-4",
    tone === "removed" && "border-dashed bg-muted/30",
    tone === "kept" && "border-primary/30 bg-primary/5",
  );
  return href ? (
    <Link
      href={href}
      className={cn(className, "group relative transition-colors hover:border-primary/50")}
    >
      <ExternalLink className="absolute end-3 top-3 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A flagged transaction beside the one it may copy: merge them, or say they're different. */
export function DuplicateReviewDialog({
  row,
  ctx,
  onClose,
}: {
  row: TxRow | null;
  ctx: TxFormContext;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"merge" | "dismiss" | null>(null);
  const name = (id?: string) => (id ? (ctx.accountNames[id] ?? "Unknown account") : "—");
  const flag = row?.duplicate;

  const decide = (choice: "merge" | "dismiss") =>
    start(async () => {
      if (!flag) return;
      setBusy(choice);
      const result =
        choice === "merge"
          ? await acceptDuplicateAction(ctx.slug, flag.suggestionId)
          : await dismissDuplicateAction(ctx.slug, flag.suggestionId);
      setBusy(null);
      if (!result.ok) return void toast.error(result.message);
      toast.success(choice === "merge" ? "Merged" : "Kept both", {
        description:
          choice === "merge"
            ? `${flag.of.number} now stands for your bank's transaction too.`
            : "Both transactions stay, and they won't be flagged again.",
      });
      onClose();
    });

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Possible duplicate</DialogTitle>
          <DialogDescription>
            Your bank sent this transaction, and it looks like one already in your books: same
            account, same amount, a few days apart at most. If they're the same, merge them. The one
            already in your books stays, and the copy is removed.
          </DialogDescription>
        </DialogHeader>
        {row && flag ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Side
              label="From your bank"
              title={row.memo || category(row, name)}
              lines={[`${row.number} · ${formatDate(row.date, ctx.locale)}`, placement(row, name)]}
              amount={signedAmount(row, ctx.locale)}
              tone="removed"
            />
            <Side
              label="Already in your books"
              title={flag.of.memo || "No description"}
              lines={[
                `${flag.of.number} · ${formatDate(flag.of.date, ctx.locale)}`,
                flag.of.origin,
              ]}
              amount={signedAmount(row, ctx.locale)}
              href={`/o/${ctx.slug}/accounting/journal/${flag.of.id}`}
              tone="kept"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => decide("dismiss")}
            disabled={pending}
          >
            {busy === "dismiss" ? <Spinner /> : <Split />}
            Not a duplicate
          </Button>
          <Button type="button" onClick={() => decide("merge")} disabled={pending}>
            {busy === "merge" ? <Spinner /> : <GitMerge />}
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Appears while transactions are ticked. Merging needs exactly two with the same amount, bank
 * account and category; the bar says what's missing otherwise.
 */
export function MergeBar({
  selected,
  ctx,
  onClear,
}: {
  selected: TxRow[];
  ctx: TxFormContext;
  onClear: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const name = (id?: string) => (id ? (ctx.accountNames[id] ?? "Unknown account") : "—");
  if (!selected.length) return null;

  const [a, b] = [...selected].sort((x, y) => entryNo(x.number) - entryNo(y.number));
  const problem =
    selected.length !== 2 || !a || !b ? "Pick two transactions to merge them." : mergeProblem(a, b);

  const merge = () =>
    start(async () => {
      if (!a || !b) return;
      const result = await mergeTransactionsAction(ctx.slug, [a.id, b.id]);
      if (!result.ok) return void toast.error(result.message);
      toast.success("Merged", { description: `${b.number} was removed; ${a.number} stays.` });
      setConfirming(false);
      onClear();
    });

  return (
    <>
      <div className="fade-in-0 slide-in-from-bottom-4 fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl animate-in items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-lg sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{selected.length} selected</p>
          <p className="line-clamp-2 text-muted-foreground text-xs">
            {problem ?? "Same amount, bank account and category: these can be merged."}
          </p>
        </div>
        <Button type="button" onClick={() => setConfirming(true)} disabled={Boolean(problem)}>
          <GitMerge />
          Merge
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X />
        </Button>
      </div>

      <Dialog open={confirming && !problem} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Merge these two transactions?</DialogTitle>
            <DialogDescription>
              The older one stays. The other is removed: it's reversed on its own date, so the
              history is kept, and its receipts and bank link move to the one that stays.
            </DialogDescription>
          </DialogHeader>
          {a && b ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Side
                label="Stays"
                title={a.memo || category(a, name)}
                lines={[`${a.number} · ${formatDate(a.date, ctx.locale)}`, placement(a, name)]}
                amount={signedAmount(a, ctx.locale)}
                tone="kept"
              />
              <Side
                label="Removed"
                title={b.memo || category(b, name)}
                lines={[`${b.number} · ${formatDate(b.date, ctx.locale)}`, placement(b, name)]}
                amount={signedAmount(b, ctx.locale)}
                tone="removed"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={merge} disabled={pending}>
              {pending ? <Spinner /> : <GitMerge />}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
