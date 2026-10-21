"use client";

import { BookCheck, Link2, Link2Off, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  dismissWalmartPayoutAction,
  matchWalmartPayoutAction,
  matchWalmartPayoutsAction,
  postWalmartSettlementsAction,
  unmatchWalmartPayoutAction,
  unpostWalmartSettlementAction,
} from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Post" (or "Post again", when Walmart changed the report since) for one settlement. */
export function PostSettlementButton({
  slug,
  settlementId,
  label,
  again = false,
}: {
  slug: string;
  settlementId: string;
  /** "Walmart Canada, Oct 1 – 14", for the toast. */
  label: string;
  again?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={again ? "outline" : "default"}
      disabled={pending}
      aria-label={`${again ? "Post again" : "Post"} ${label}`}
      onClick={() =>
        start(async () => {
          const result = await postWalmartSettlementsAction(slug, { settlementId });
          if (!result.ok) return void toast.error(result.message);
          toast.success(`${label} is in your books`);
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <BookCheck />}
      {again ? "Post again" : "Post"}
    </Button>
  );
}

/** Takes a settlement back out of the books (asks once more first). */
export function UnpostSettlementButton({
  slug,
  settlementId,
  label,
}: {
  slug: string;
  settlementId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sure, setSure] = useState(false);
  return (
    <Button
      size="sm"
      variant={sure ? "destructive" : "ghost"}
      disabled={pending}
      aria-label={sure ? `Click again to take ${label} out` : `Take ${label} out of the books`}
      onClick={() => {
        if (!sure) return setSure(true);
        start(async () => {
          const result = await unpostWalmartSettlementAction(slug, { settlementId });
          setSure(false);
          if (!result.ok) return void toast.error(result.message);
          toast.success(`${label} is out of your books`);
          router.refresh();
        });
      }}
    >
      {pending ? <Spinner /> : <Undo2 />}
      {sure ? "Click again to take out" : "Take out"}
    </Button>
  );
}

/** "Post N settlements": every settlement ready (or changed), oldest first. */
export function PostAllSettlementsButton({ slug, count }: { slug: string; count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await postWalmartSettlementsAction(slug, { all: true });
          if (!result.ok) return void toast.error(result.message);
          if (result.posted) {
            toast.success(`${plural(result.posted, "settlement")} in your books`, {
              description: result.failed
                ? `${plural(result.failed, "settlement")} couldn't post: ${result.message}`
                : undefined,
            });
          } else if (result.message) {
            toast.error(result.message);
          }
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <BookCheck />}
      {`Post ${plural(count, "settlement")}`}
    </Button>
  );
}

/** "Match" and "Not this one" for a payout's possible deposit. */
export function PayoutChoice({
  slug,
  settlementId,
  entryId,
  converted = false,
}: {
  slug: string;
  settlementId: string;
  entryId: string;
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
          ? await matchWalmartPayoutAction(slug, { settlementId, entryId })
          : await dismissWalmartPayoutAction(slug, { settlementId, entryId });
      if (!result.ok) return void toast.error(result.message);
      if (kind === "match") {
        toast.success("Deposit matched", {
          description:
            "The payout now comes out of your Walmart balance, so it isn't income twice.",
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

export function UnmatchPayoutButton({
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
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await unmatchWalmartPayoutAction(slug, settlementId);
          if (!result.ok) return void toast.error(result.message);
          toast.success("Deposit unmatched", { description: "It's back in its old category." });
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <Link2Off />}
      Unmatch
    </Button>
  );
}

/** "Match N payouts": every payout with exactly one deposit of its amount. */
export function MatchAllPayoutsButton({ slug, count }: { slug: string; count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await matchWalmartPayoutsAction(slug);
          if (!result.ok) return void toast.error(result.message);
          if (result.matched) {
            toast.success(`${plural(result.matched, "payout")} matched to their deposits`, {
              description: result.failed
                ? `${plural(result.failed, "payout")} couldn't be matched: ${result.message}`
                : undefined,
            });
          } else if (result.message) {
            toast.error(result.message);
          }
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <Link2 />}
      {`Match ${plural(count, "payout")}`}
    </Button>
  );
}
