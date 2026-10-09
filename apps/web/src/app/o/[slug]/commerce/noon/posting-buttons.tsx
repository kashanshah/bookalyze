"use client";

import { BookCheck, Link2, Link2Off, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  dismissNoonPayoutAction,
  matchNoonPayoutAction,
  matchNoonPayoutsAction,
  postNoonMonthsAction,
  unmatchNoonPayoutAction,
  unpostNoonMonthAction,
} from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Post" (or "Post again", when Noon's rows changed since) for one country's month. */
export function PostMonthButton({
  slug,
  channelId,
  month,
  label,
  again = false,
}: {
  slug: string;
  channelId: string;
  month: string;
  /** "September 2026", for the toast. */
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
          const result = await postNoonMonthsAction(slug, { channelId, month });
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

/** Takes a month back out of the books (asks once more first). */
export function UnpostMonthButton({
  slug,
  channelId,
  month,
  label,
}: {
  slug: string;
  channelId: string;
  month: string;
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
          const result = await unpostNoonMonthAction(slug, { channelId, month });
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

/** "Post N months": every finished month ready (or changed), oldest first. */
export function PostAllMonthsButton({ slug, count }: { slug: string; count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await postNoonMonthsAction(slug, { all: true });
          if (!result.ok) return void toast.error(result.message);
          if (result.posted) {
            toast.success(`${plural(result.posted, "month")} in your books`, {
              description: result.failed
                ? `${plural(result.failed, "month")} couldn't post: ${result.message}`
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
      {`Post ${plural(count, "month")}`}
    </Button>
  );
}

/** "Match" and "Not this one" for a payout's possible deposit. */
export function PayoutChoice({
  slug,
  transactionId,
  entryId,
  converted = false,
}: {
  slug: string;
  transactionId: string;
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
          ? await matchNoonPayoutAction(slug, { transactionId, entryId })
          : await dismissNoonPayoutAction(slug, { transactionId, entryId });
      if (!result.ok) return void toast.error(result.message);
      if (kind === "match") {
        toast.success("Deposit matched", {
          description: "The payout now comes out of your Noon balance, so it isn't income twice.",
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
  transactionId,
}: {
  slug: string;
  transactionId: string;
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
          const result = await unmatchNoonPayoutAction(slug, transactionId);
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
          const result = await matchNoonPayoutsAction(slug);
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
