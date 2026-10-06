"use client";

import { Link2, Link2Off, X } from "lucide-react";
import { useRouter } from "next/navigation";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  dismissDepositAction,
  matchDepositAction,
  matchFoundDepositsAction,
  unmatchDepositAction,
} from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Match" and "Not this one" for one possible deposit. */
export function DepositChoice({
  slug,
  settlementId,
  entryId,
  converted = false,
}: {
  slug: string;
  settlementId: string;
  entryId: string;
  /** Paid in another currency: the button says the rate is accepted. */
  converted?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"match" | "dismiss" | null>(null);
  const run = (kind: "match" | "dismiss") => {
    setWhich(kind);
    start(async () => {
      const result =
        kind === "match"
          ? await matchDepositAction(slug, { settlementId, entryId })
          : await dismissDepositAction(slug, { settlementId, entryId });
      if (!result.ok) return void toast.error(result.message);
      if (kind === "match") {
        toast.success("Deposit matched", {
          description: "It now clears the payout, so the sales are counted once.",
        });
      }
      router.refresh();
    });
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => run("match")} disabled={pending}>
        {pending && which === "match" ? <Spinner /> : <Link2 />}
        {converted ? "Match at this rate" : "Match"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => run("dismiss")} disabled={pending}>
        {pending && which === "dismiss" ? <Spinner /> : <X />}
        Not this one
      </Button>
    </div>
  );
}

/** Puts the deposit back as it was before matching. */
export function UnmatchDepositButton({
  slug,
  settlementId,
}: {
  slug: string;
  settlementId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() =>
        start(async () => {
          const result = await unmatchDepositAction(slug, settlementId);
          if (!result.ok) return void toast.error(result.message);
          toast.success("Deposit unmatched", {
            description: "It's back in the category it had before.",
          });
          router.refresh();
        })
      }
      disabled={pending}
    >
      {pending ? <Spinner /> : <Link2Off />}
      Unmatch
    </Button>
  );
}

/** "Match N deposits": every posted settlement with exactly one possible deposit, after a check. */
export function MatchFoundDepositsButton({
  slug,
  count,
  categorized,
}: {
  slug: string;
  count: number;
  /** How many of them already have a category (other than Uncategorized) that will change. */
  categorized: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const match = () =>
    start(async () => {
      const result = await matchFoundDepositsAction(slug);
      if (!result.ok) return void toast.error(result.message);
      setOpen(false);
      router.refresh();
      if (result.matched) {
        toast.success(
          `${plural(result.matched, "deposit")} matched`,
          result.failed
            ? { description: `${plural(result.failed, "deposit")} couldn't be: ${result.message}` }
            : {},
        );
      } else if (result.message) {
        toast.error(result.message);
      }
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Link2 />
          Match {plural(count, "deposit")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Match {plural(count, "deposit")}?</DialogTitle>
          <DialogDescription>
            Each of these settlements has exactly one bank deposit of its payout amount, a few days
            from Amazon's deposit date. Matching moves each deposit to the clearing account, so its
            sales are counted once: in the settlement.
          </DialogDescription>
        </DialogHeader>
        {categorized ? (
          <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm">
            {categorized === count
              ? `All ${count} already have a category (Amazon Sales, say).`
              : `${categorized} of them already have a category (Amazon Sales, say).`}{" "}
            It changes to the clearing account. Unmatch on the settlement puts it back.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={match} disabled={pending}>
            {pending ? <Spinner /> : <Link2 />}
            {pending ? "Matching…" : "Match them"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
