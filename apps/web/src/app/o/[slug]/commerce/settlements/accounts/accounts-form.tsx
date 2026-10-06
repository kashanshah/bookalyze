"use client";

import {
  SETTLEMENT_ACCOUNT_HINTS,
  SETTLEMENT_GROUPS,
  type SettlementAccountKey,
} from "@bookalyze/core";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { saveSettlementSetupAction } from "../actions";

const LABELS: Record<SettlementAccountKey, string> = {
  ...SETTLEMENT_GROUPS,
  clearing: "Amazon clearing (the payout)",
};

export function SettlementAccountsForm({
  slug,
  keys,
  initial,
  postFrom: initialFrom,
  options,
  suggested,
  canManage,
  locale,
}: {
  slug: string;
  keys: SettlementAccountKey[];
  initial: Record<string, string>;
  postFrom: string;
  options: (ComboboxOption & { type: string })[];
  suggested: boolean;
  canManage: boolean;
  locale: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [postFrom, setPostFrom] = useState(initialFrom);
  const [pending, start] = useTransition();
  // The clearing account holds money in transit: assets only.
  const optionsFor = (key: SettlementAccountKey) =>
    key === "clearing" ? options.filter((o) => o.type === "asset") : options;

  const save = () =>
    start(async () => {
      const result = await saveSettlementSetupAction(slug, { accounts: values, postFrom });
      if (!result.ok) return void toast.error(result.message);
      toast.success("Saved", { description: "Settlements post with these accounts from now on." });
      router.push(`/o/${slug}/commerce/settlements`);
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        {suggested ? (
          <p className="flex items-center gap-2 border-b bg-primary/5 px-5 py-3 text-sm">
            <Sparkles className="size-4 shrink-0 text-primary" />
            Suggested from your accounts' names. Check each one, then save.
          </p>
        ) : null}
        <ul className="divide-y">
          {keys.map((key) => (
            <li
              key={key}
              className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_18rem] sm:gap-6"
            >
              <div className="min-w-0">
                <p className="font-medium text-sm" id={`settlement-${key}-label`}>
                  {LABELS[key]}
                </p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {SETTLEMENT_ACCOUNT_HINTS[key]}
                </p>
              </div>
              <Combobox
                aria-labelledby={`settlement-${key}-label`}
                value={values[key] ?? ""}
                onChange={(v) => setValues((s) => ({ ...s, [key]: v }))}
                options={optionsFor(key)}
                placeholder="Choose an account"
                disabled={!canManage || pending}
              />
            </li>
          ))}
        </ul>
      </section>
      <aside className="grid h-fit gap-4 rounded-2xl border bg-card p-5 shadow-xs">
        <Field
          label="Post settlements from"
          htmlFor="settlements-from"
          hint="Settlements whose period ends on or after this day go into the books. Earlier ones stay out: your books (from Wave, say) have those payouts already."
        >
          <Input
            id="settlements-from"
            type="date"
            value={postFrom}
            onChange={(e) => setPostFrom(e.target.value)}
            disabled={!canManage || pending}
          />
        </Field>
        <p className="text-muted-foreground text-xs">
          From {postFrom ? formatDate(postFrom, locale, "long") : "the date above"}. You choose when
          each one posts, and can take it back out.
        </p>
        {canManage ? (
          <Button onClick={save} disabled={pending}>
            {pending ? <Spinner /> : null}
            {pending ? "Saving…" : "Save"}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">An owner or admin can change these.</p>
        )}
      </aside>
    </div>
  );
}
