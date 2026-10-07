"use client";

import {
  type AccountType,
  accountTypes,
  SETTLEMENT_ACCOUNT_HINTS,
  SETTLEMENT_GROUPS,
  type SettlementAccountKey,
} from "@bookalyze/core";
import { Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { NewAccountForm, type NewCategory } from "@/components/accounting/category-picker";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/dates";
import { saveSettlementSetupAction } from "../actions";

const LABELS: Record<SettlementAccountKey, string> = {
  ...SETTLEMENT_GROUPS,
  clearing: "Amazon clearing (the payout)",
};

type AccountOption = ComboboxOption & { type: string };

/** The type and purpose a new account opens with, for this settlement line. */
const NEW_ACCOUNT: Record<SettlementAccountKey, { type: AccountType; subtype: string }> = {
  sales: { type: "income", subtype: "income" },
  refunds: { type: "income", subtype: "income" },
  promotions: { type: "income", subtype: "discount" },
  reimbursements: { type: "income", subtype: "other_income" },
  fees: { type: "expense", subtype: "payment_processing_fee" },
  advertising: { type: "expense", subtype: "operating_expense" },
  feeTax: { type: "liability", subtype: "sales_tax" },
  tax: { type: "liability", subtype: "sales_tax" },
  reserve: { type: "asset", subtype: "money_in_transit" },
  other: { type: "asset", subtype: "money_in_transit" },
  clearing: { type: "asset", subtype: "money_in_transit" },
};

/** Keep a new account with the others of its type, so the dropdown doesn't split the group. */
function insertOption(list: AccountOption[], option: AccountOption): AccountOption[] {
  if (list.some((o) => o.value === option.value)) return list;
  const last = list.findLastIndex((o) => o.group === option.group);
  if (last < 0) return [...list, option];
  const next = [...list];
  next.splice(last + 1, 0, option);
  return next;
}

export function SettlementAccountsForm({
  slug,
  keys,
  initial,
  postFrom: initialFrom,
  autoPost: initialAuto,
  options,
  suggested,
  canManage,
  locale,
}: {
  slug: string;
  keys: SettlementAccountKey[];
  initial: Record<string, string>;
  postFrom: string;
  autoPost: boolean;
  options: AccountOption[];
  suggested: boolean;
  canManage: boolean;
  locale: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [postFrom, setPostFrom] = useState(initialFrom);
  const [autoPost, setAutoPost] = useState(initialAuto);
  const [added, setAdded] = useState<AccountOption[]>([]);
  const [creating, setCreating] = useState<{ key: SettlementAccountKey; name: string } | null>(
    null,
  );
  const [pending, start] = useTransition();
  const accounts = useMemo(
    () => added.reduce((list, option) => insertOption(list, option), options),
    [options, added],
  );
  // The clearing account holds money in transit: assets only.
  const optionsFor = (key: SettlementAccountKey) =>
    key === "clearing" ? accounts.filter((o) => o.type === "asset") : accounts;

  const created = (key: SettlementAccountKey, account: NewCategory) => {
    setAdded((list) =>
      insertOption(list, {
        value: account.id,
        label: account.label,
        group: accountTypes[account.type].label,
        type: account.type,
      }),
    );
    if (key === "clearing" && account.type !== "asset") {
      toast.message("Choose an asset for the payout", {
        description: `${account.name} is in your chart. Amazon clearing has to be an asset, such as money in transit.`,
      });
      return;
    }
    setValues((s) => ({ ...s, [key]: account.id }));
  };

  const save = () =>
    start(async () => {
      const result = await saveSettlementSetupAction(slug, {
        accounts: values,
        postFrom,
        autoPost,
      });
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
                searchPlaceholder="Search accounts or codes"
                emptyText="No account matches. Add it as a new one below."
                disabled={!canManage || pending}
                footer={
                  canManage
                    ? (query, close) => (
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            setCreating({ key, name: query.trim() });
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start font-medium text-primary text-sm transition-colors hover:bg-accent"
                        >
                          <Plus className="size-4 shrink-0" />
                          <span className="min-w-0 truncate">
                            {query.trim()
                              ? `Add “${query.trim()}” as a new account`
                              : "Add a new account"}
                          </span>
                        </button>
                      )
                    : undefined
                }
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
        <div className="grid gap-1.5 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="settlements-auto" className="font-medium text-sm">
              Post new settlements automatically
            </label>
            <Switch
              id="settlements-auto"
              checked={autoPost}
              onCheckedChange={setAutoPost}
              disabled={!canManage || pending}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Every evening, new settlements post, and a deposit of exactly the payout (same amount,
            same currency) is matched when it's uncategorized or in your sales account. Deposits in
            another currency always wait for you to check the rate.
          </p>
        </div>
        {canManage ? (
          <Button onClick={save} disabled={pending}>
            {pending ? <Spinner /> : null}
            {pending ? "Saving…" : "Save"}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">An owner or admin can change these.</p>
        )}
      </aside>
      <Dialog open={creating !== null} onOpenChange={(open) => !open && setCreating(null)}>
        <DialogContent>
          {creating ? (
            <NewAccountForm
              slug={slug}
              initialName={creating.name}
              defaultType={NEW_ACCOUNT[creating.key].type}
              defaultSubtype={NEW_ACCOUNT[creating.key].subtype}
              title="Add an account"
              description="This account is added to your chart of accounts, then selected for this line."
              submitLabel="Add account"
              addedDescription="It's in your chart of accounts."
              onCancel={() => setCreating(null)}
              onSaved={(account) => {
                const key = creating.key;
                setCreating(null);
                created(key, account);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
