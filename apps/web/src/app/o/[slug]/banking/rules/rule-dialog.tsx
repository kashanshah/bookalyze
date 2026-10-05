"use client";

import type { RuleDirection } from "@bookalyze/core";
import { Wand2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CategoryPicker, useCategoryList } from "@/components/accounting/category-picker";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { applyRuleAction, countMatchesAction, type RuleFormInput, saveRuleAction } from "./actions";
import type { RuleFormContext, RuleView } from "./types";

export type RuleDraft = {
  matchText: string;
  direction: RuleDirection;
  amountMin: string;
  amountMax: string;
  accountId: string;
  categoryAccountId: string;
  contactId: string;
  isActive: boolean;
};

export const emptyDraft: RuleDraft = {
  matchText: "",
  direction: "any",
  amountMin: "",
  amountMax: "",
  accountId: "",
  categoryAccountId: "",
  contactId: "",
  isActive: true,
};

/** "85.5000" → "85.5", "100.0000" → "100": a stored amount as someone would type it. */
const typed = (amount: string | null) =>
  amount ? (amount.includes(".") ? amount.replace(/0+$/, "").replace(/\.$/, "") : amount) : "";

export function draftOf(rule: RuleView): RuleDraft {
  return {
    matchText: rule.matchText,
    direction: rule.direction,
    amountMin: typed(rule.amountMin),
    amountMax: typed(rule.amountMax),
    accountId: rule.accountId ?? "",
    categoryAccountId: rule.categoryAccountId,
    contactId: rule.contactId ?? "",
    isActive: rule.isActive,
  };
}

/** Writing or changing a rule, with a live count of what it would categorize today. */
export function RuleDialog({
  open,
  onOpenChange,
  ctx,
  rule,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: RuleFormContext;
  /** The rule being changed; a new one when absent. */
  rule?: RuleView;
  initial: RuleDraft;
}) {
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const categories = useCategoryList(ctx.categories);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const input: RuleFormInput = { ...draft };

  // Count what it would categorize as the rule takes shape (debounced).
  useEffect(() => {
    if (!open || draft.matchText.trim().length < 2 || !draft.categoryAccountId) {
      setMatches(null);
      return;
    }
    const t = setTimeout(async () => {
      const result = await countMatchesAction(ctx.slug, { ...draft }).catch(() => null);
      setMatches(result?.ok ? result.count : null);
    }, 400);
    return () => clearTimeout(t);
  }, [open, draft, ctx.slug]);

  const save = (applyNow: boolean) =>
    start(async () => {
      const result = await saveRuleAction(ctx.slug, rule?.id ?? null, input);
      if (!result.ok) {
        setErrors(result.errors ?? {});
        if (!result.errors) toast.error(result.message);
        return;
      }
      setErrors({});
      if (applyNow && matches) {
        const applied = await applyRuleAction(ctx.slug, result.id);
        if (applied.ok) {
          toast.success(rule ? "Rule saved" : "Rule added", {
            description: `${applied.categorized} ${applied.categorized === 1 ? "transaction" : "transactions"} categorized${applied.skipped ? `; ${applied.skipped} in a closed or reconciled period left as they were` : ""}. Review them on the Transactions screen.`,
          });
        } else toast.error(applied.message);
      } else {
        toast.success(rule ? "Rule saved" : "Rule added", {
          description: "New bank transactions that match it will be categorized as they arrive.",
        });
      }
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Change rule" : "New rule"}</DialogTitle>
          <DialogDescription>
            When a bank transaction matches, it's put in the category you choose instead of
            Uncategorized. You still tick it as reviewed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field
            label="When the description contains"
            htmlFor="rule-text"
            error={errors.matchText}
            hint="Upper or lower case doesn't matter, e.g. BELL CANADA."
            className="sm:col-span-2"
          >
            <Input
              id="rule-text"
              value={draft.matchText}
              onChange={(e) => set({ matchText: e.target.value })}
              placeholder="e.g. Bell Canada"
              aria-invalid={Boolean(errors.matchText)}
              autoFocus
            />
          </Field>
          <Field label="Money" htmlFor="rule-direction">
            <Combobox
              id="rule-direction"
              value={draft.direction}
              onChange={(v) => set({ direction: v as RuleDirection })}
              options={[
                { value: "any", label: "In or out" },
                { value: "out", label: "Money out only" },
                { value: "in", label: "Money in only" },
              ]}
            />
          </Field>
          <Field label="On" htmlFor="rule-account">
            <Combobox
              id="rule-account"
              value={draft.accountId}
              onChange={(v) => set({ accountId: v })}
              options={[
                { value: "", label: "Any bank or card account" },
                ...ctx.moneyAccounts.map((a) => ({ value: a.id, label: a.label })),
              ]}
            />
          </Field>
          <Field
            label="Amount from (optional)"
            htmlFor="rule-min"
            error={errors.amountMin}
            hint="Leave empty for any amount."
          >
            <Input
              id="rule-min"
              inputMode="decimal"
              value={draft.amountMin}
              onChange={(e) => set({ amountMin: e.target.value })}
              placeholder="0.00"
              className="tabular"
            />
          </Field>
          <Field label="Amount up to (optional)" htmlFor="rule-max" error={errors.amountMax}>
            <Input
              id="rule-max"
              inputMode="decimal"
              value={draft.amountMax}
              onChange={(e) => set({ amountMax: e.target.value })}
              placeholder="No limit"
              className="tabular"
            />
          </Field>
          <Field
            label="Put it in"
            htmlFor="rule-category"
            error={errors.categoryAccountId}
            className="sm:col-span-2"
          >
            <CategoryPicker
              id="rule-category"
              slug={ctx.slug}
              groups={categories.groups}
              value={draft.categoryAccountId}
              direction={draft.direction}
              onChange={(v) => set({ categoryAccountId: v })}
              onCreated={categories.add}
              invalid={Boolean(errors.categoryAccountId)}
            />
          </Field>
          <Field
            label="Customer or vendor (optional)"
            htmlFor="rule-contact"
            className="sm:col-span-2"
          >
            <Combobox
              id="rule-contact"
              value={draft.contactId}
              onChange={(v) => set({ contactId: v })}
              options={[
                { value: "", label: "None" },
                ...ctx.contacts.map((c) => ({ value: c.id, label: c.name })),
              ]}
              searchPlaceholder="Search customers and vendors"
            />
          </Field>
          <div className="flex items-center gap-3 text-sm sm:col-span-2">
            <Switch
              id="rule-active"
              checked={draft.isActive}
              onCheckedChange={(v) => set({ isActive: v })}
            />
            <Label htmlFor="rule-active" className="font-normal">
              {draft.isActive ? "On: used for new transactions" : "Off: kept, but not used"}
            </Label>
          </div>
        </div>

        <p
          className="flex items-center gap-2 rounded-xl bg-muted/40 px-4 py-3 text-sm"
          aria-live="polite"
        >
          <Wand2 className="size-4 shrink-0 text-primary" />
          {matches === null
            ? "Fill in the words and the category to see what it matches."
            : matches === 0
              ? "Nothing uncategorized matches it right now. It will catch new transactions."
              : `${matches} uncategorized ${matches === 1 ? "transaction matches" : "transactions match"} it today.`}
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {matches ? (
            <Button type="button" variant="outline" onClick={() => save(false)} disabled={pending}>
              Save only
            </Button>
          ) : null}
          <Button type="button" onClick={() => save(Boolean(matches))} disabled={pending}>
            {pending ? <Spinner /> : null}
            {matches ? `Save and categorize ${matches}` : rule ? "Save rule" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
