"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, nextDay } from "@/lib/dates";
import { startReconciliationAction, undoReconciliationAction } from "../actions";

/** The statement to reconcile against: its closing date and ending balance. */
export function StartReconciliation({
  slug,
  accountId,
  statementWord,
  today,
  after,
  locale,
  currency,
}: {
  slug: string;
  accountId: string;
  statementWord: string;
  today: string;
  /** Reconciled through this date already: the next statement must end later. */
  after: string | null;
  locale: string;
  currency: string;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="fade-in-0 slide-in-from-bottom-1 grid animate-in gap-5 rounded-2xl border bg-card p-5 shadow-xs sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await startReconciliationAction(slug, accountId, {
            statementDate: String(data.get("statementDate") ?? ""),
            statementBalance: String(data.get("statementBalance") ?? ""),
          });
          if (result.ok) router.refresh();
          else {
            setErrors(result.errors ?? {});
            if (result.message) toast.error(result.message);
          }
        });
      }}
    >
      <div>
        <h2 className="font-semibold tracking-tight">Start with your {statementWord}</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {after
            ? `Reconciled through ${formatDate(after, locale, "long")}. Enter the next statement's closing date and ending balance.`
            : "Enter the closing date and ending balance from a statement. Start with your oldest one if you're catching up."}
        </p>
      </div>
      <fieldset disabled={pending} className="grid gap-5 sm:grid-cols-2">
        <Field label="Statement closing date" htmlFor="statementDate" error={errors.statementDate}>
          <Input
            id="statementDate"
            name="statementDate"
            type="date"
            required
            defaultValue={today}
            min={after ? nextDay(after) : undefined}
          />
        </Field>
        <Field
          label={`Ending balance (${currency})`}
          htmlFor="statementBalance"
          error={errors.statementBalance}
          hint={
            statementWord === "statement"
              ? "What the statement says you owe. Use a minus sign for a credit balance."
              : "What the statement says was in the account. Use a minus sign if it was overdrawn."
          }
        >
          <Input
            id="statementBalance"
            name="statementBalance"
            inputMode="decimal"
            required
            placeholder="0.00"
            className="tabular text-end"
          />
        </Field>
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Start reconciling
        </Button>
      </div>
    </form>
  );
}

/** Reopens the latest reconciliation so its transactions can be changed. */
export function UndoReconciliationButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <Button
      type="button"
      size="sm"
      variant={confirming ? "destructive" : "ghost"}
      disabled={pending}
      onClick={() => {
        if (!confirming) return setConfirming(true);
        startTransition(async () => {
          const result = await undoReconciliationAction(slug, id);
          if (result.ok) {
            toast.success("Reconciliation reopened", {
              description: "Its transactions can be changed again. Finish it when you're done.",
            });
            router.refresh();
          } else toast.error(result.message ?? "Something went wrong");
          setConfirming(false);
        });
      }}
    >
      {pending ? <Spinner /> : <Undo2 />}
      {confirming ? "Click again to reopen it" : "Undo"}
    </Button>
  );
}
