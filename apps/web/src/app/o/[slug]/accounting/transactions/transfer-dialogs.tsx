"use client";

import { formatMoney } from "@bookalyze/core";
import { ArrowRightLeft, Split } from "lucide-react";
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
import { dismissTransferAction, matchTransferAction } from "./actions";
import { Side, signedAmount } from "./duplicate-dialogs";
import type { TxFormContext, TxRow } from "./types";

/**
 * A suggested transfer: this transaction beside the one that looks like its other side. Matching
 * turns the two into one transfer; "Not a transfer" leaves both and stops suggesting the pair.
 */
export function TransferReviewDialog({
  row,
  ctx,
  onClose,
}: {
  row: TxRow | null;
  ctx: TxFormContext;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"match" | "dismiss" | null>(null);
  const name = (id?: string) => (id ? (ctx.accountNames[id] ?? "Unknown account") : "—");
  const pair = row?.transfer;
  const rowIsOut = pair ? pair.outId === row?.id : false;

  const decide = (choice: "match" | "dismiss") =>
    start(async () => {
      if (!pair) return;
      setBusy(choice);
      const result =
        choice === "match"
          ? await matchTransferAction(ctx.slug, { outId: pair.outId, inId: pair.inId })
          : await dismissTransferAction(ctx.slug, pair.outId, pair.inId);
      setBusy(null);
      if (!result.ok) return void toast.error(result.message);
      toast.success(choice === "match" ? "Matched as a transfer" : "Kept apart", {
        description:
          choice === "match"
            ? "The two are now one transfer between your accounts."
            : "Both stay as they are, and they won't be suggested together again.",
      });
      onClose();
    });

  const thisSide = row
    ? {
        title: row.memo || "No description",
        lines: [
          `${row.number} · ${formatDate(row.date, ctx.locale)}`,
          name(row.moneyAccountIds[0]),
        ],
        amount: signedAmount(row, ctx.locale),
      }
    : null;
  const otherSide = pair
    ? {
        title: pair.other.memo || "No description",
        lines: [
          `${pair.other.number} · ${formatDate(pair.other.date, ctx.locale)}`,
          name(pair.other.accountId),
        ],
        amount: `${rowIsOut ? "+" : "−"}${formatMoney(pair.other.amount, pair.other.currency, ctx.locale)}`,
      }
    : null;
  const [sent, received] = rowIsOut ? [thisSide, otherSide] : [otherSide, thisSide];

  return (
    <Dialog open={Boolean(row && pair)} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Possible transfer</DialogTitle>
          <DialogDescription>
            Money left one of your accounts and about the same arrived in another within a few days.
            If you moved it yourself, match them: they become one transfer, so it isn't counted as
            an expense and as income.
          </DialogDescription>
        </DialogHeader>
        {sent && received ? (
          <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Side label="Money out" {...sent} />
            <ArrowRightLeft className="mx-auto size-4 rotate-90 text-muted-foreground sm:rotate-0" />
            <Side label="Money in" {...received} tone="kept" />
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
            Not a transfer
          </Button>
          <Button type="button" onClick={() => decide("match")} disabled={pending}>
            {busy === "match" ? <Spinner /> : <ArrowRightLeft />}
            Match as transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
