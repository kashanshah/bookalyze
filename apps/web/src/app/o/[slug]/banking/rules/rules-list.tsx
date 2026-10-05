"use client";

import { formatMoney } from "@bookalyze/core";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { applyRuleAction, deleteRuleAction, moveRuleAction } from "./actions";
import { draftOf, emptyDraft, RuleDialog, type RuleDraft } from "./rule-dialog";
import type { RuleFormContext, RuleView } from "./types";

/** "money out · $50.00 to $100.00 · on RBC Chequing" */
function conditions(rule: RuleView, ctx: RuleFormContext): string {
  const money = (v: string) => formatMoney(v, ctx.currency, ctx.locale);
  const parts: string[] = [];
  if (rule.direction !== "any") parts.push(rule.direction === "in" ? "money in" : "money out");
  if (rule.amountMin && rule.amountMax)
    parts.push(`${money(rule.amountMin)} to ${money(rule.amountMax)}`);
  else if (rule.amountMin) parts.push(`${money(rule.amountMin)} or more`);
  else if (rule.amountMax) parts.push(`up to ${money(rule.amountMax)}`);
  if (rule.accountName) parts.push(`on ${rule.accountName}`);
  return parts.join(" · ");
}

export function RulesList({
  rules,
  ctx,
  prefill,
}: {
  rules: RuleView[];
  ctx: RuleFormContext;
  prefill: { matchText: string; categoryAccountId: string; accountId: string } | null;
}) {
  const [editing, setEditing] = useState<{ rule?: RuleView; initial: RuleDraft } | null>(
    prefill ? { initial: { ...emptyDraft, ...prefill } } : null,
  );
  const [key, setKey] = useState(0);
  const [deleting, setDeleting] = useState<RuleView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = (rule?: RuleView) => {
    setKey((k) => k + 1);
    setEditing({ rule, initial: rule ? draftOf(rule) : emptyDraft });
  };
  const run = (id: string, task: () => Promise<void>) =>
    start(async () => {
      setBusy(id);
      await task();
      setBusy(null);
    });
  const apply = (rule: RuleView) =>
    run(`apply:${rule.id}`, async () => {
      const result = await applyRuleAction(ctx.slug, rule.id);
      if (!result.ok) return void toast.error(result.message);
      if (!result.categorized && !result.skipped) {
        toast.message("Nothing to categorize", {
          description: "No uncategorized transaction matches this rule right now.",
        });
      } else {
        toast.success(
          `${result.categorized} ${result.categorized === 1 ? "transaction" : "transactions"} categorized`,
          {
            description: `${result.skipped ? `${result.skipped} in a closed or reconciled period were left as they were. ` : ""}Review them on the Transactions screen.`,
          },
        );
      }
    });
  const move = (rule: RuleView, direction: "up" | "down") =>
    run(`move:${rule.id}`, async () => {
      const result = await moveRuleAction(ctx.slug, rule.id, direction);
      if (!result.ok) toast.error(result.message);
    });
  const remove = () =>
    deleting &&
    run(`delete:${deleting.id}`, async () => {
      const result = await deleteRuleAction(ctx.slug, deleting.id);
      if (!result.ok) return void toast.error(result.message);
      setDeleting(null);
      toast.success("Rule deleted", {
        description: "Transactions it categorized keep their category.",
      });
    });

  return (
    <div className="grid gap-5">
      {rules.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-14 text-center shadow-xs">
          <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
          <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
            <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
              <Wand2 className="size-7" />
            </span>
            <div>
              <h2 className="font-semibold text-lg tracking-tight">
                Let the regulars sort themselves
              </h2>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                Phone bills, software subscriptions, rent: write a rule once and those transactions
                arrive in the right category from your bank, ready for a quick review.
              </p>
            </div>
            <Button onClick={() => open()}>
              <Plus />
              New rule
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Tried from the top; the first rule that matches is used.
            </p>
            <Button onClick={() => open()}>
              <Plus />
              New rule
            </Button>
          </div>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
            {rules.map((rule, i) => {
              const extra = conditions(rule, ctx);
              return (
                <li
                  key={rule.id}
                  className={cn(
                    "fade-in-0 flex animate-in flex-wrap items-center gap-x-4 gap-y-2 fill-mode-both px-4 py-3.5 sm:px-5",
                    !rule.isActive && "opacity-60",
                  )}
                  style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                >
                  <div className="flex flex-col gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => move(rule, "up")}
                      disabled={i === 0 || pending}
                      aria-label={`Move rule for ${rule.matchText} up`}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => move(rule, "down")}
                      disabled={i === rules.length - 1 || pending}
                      aria-label={`Move rule for ${rule.matchText} down`}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => open(rule)}
                    className="min-w-0 flex-1 text-start"
                  >
                    <p className="text-sm">
                      <span className="text-muted-foreground">Contains </span>
                      <span className="font-medium">“{rule.matchText}”</span>
                      <span className="text-muted-foreground"> → </span>
                      <span className="font-medium">{rule.categoryName}</span>
                      {rule.contactName ? (
                        <span className="text-muted-foreground"> · {rule.contactName}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
                      {extra ? <span>{extra}</span> : null}
                      <span>
                        {rule.applied
                          ? `Categorized ${rule.applied} ${rule.applied === 1 ? "transaction" : "transactions"}`
                          : "Not used yet"}
                      </span>
                      {rule.isActive ? null : <Badge variant="outline">Off</Badge>}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => apply(rule)}
                      disabled={pending}
                    >
                      {busy === `apply:${rule.id}` ? <Spinner /> : <Wand2 />}
                      Apply to uncategorized
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => open(rule)}
                      aria-label={`Change rule for ${rule.matchText}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleting(rule)}
                      aria-label={`Delete rule for ${rule.matchText}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <RuleDialog
        key={key}
        open={Boolean(editing)}
        onOpenChange={(v) => (v ? null : setEditing(null))}
        ctx={ctx}
        rule={editing?.rule}
        initial={editing?.initial ?? emptyDraft}
      />

      <Dialog open={Boolean(deleting)} onOpenChange={(v) => (v ? null : setDeleting(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this rule?</DialogTitle>
            <DialogDescription>
              New transactions containing “{deleting?.matchText}” will arrive uncategorized again.
              Transactions it already categorized keep their category.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {busy?.startsWith("delete:") ? <Spinner /> : <Trash2 />}
              Delete rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
