"use client";

import { type AccountType, accountTypes } from "@bookalyze/core";
import { Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState, useTransition } from "react";
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

export type PostingAccountOption = ComboboxOption & { type: string };

type SaveResult = { ok: true } | { ok: false; message: string };

/** Keep a new account with the others of its type, so the dropdown doesn't split the group. */
function insertOption(
  list: PostingAccountOption[],
  option: PostingAccountOption,
): PostingAccountOption[] {
  if (list.some((o) => o.value === option.value)) return list;
  const last = list.findLastIndex((o) => o.group === option.group);
  if (last < 0) return [...list, option];
  const next = [...list];
  next.splice(last + 1, 0, option);
  return next;
}

/**
 * "How … posts": an account for each kind of amount a marketplace reports, the clearing account
 * (an asset) its payouts go through, and when posting starts. Shared by Amazon settlements and
 * Noon. Each dropdown can add a new account, opening on a fitting type.
 */
export function PostingAccountsForm({
  slug,
  idPrefix,
  keys,
  labels,
  hints,
  newAccount,
  clearingKey,
  clearingHint,
  initial,
  postFrom: initialFrom,
  postFromField,
  autoPost: initialAuto,
  autoPostField,
  options,
  suggested,
  canManage,
  locale,
  save,
  savedDescription,
  doneHref,
}: {
  slug: string;
  idPrefix: string;
  keys: readonly string[];
  labels: Record<string, string>;
  hints: Record<string, string>;
  newAccount: Record<string, { type: AccountType; subtype: string }>;
  clearingKey: string;
  /** Said when a new account added for the clearing line isn't an asset. */
  clearingHint: string;
  initial: Record<string, string>;
  /** YYYY-MM-DD; with `postFromField.month`, the first day of a month. */
  postFrom: string;
  postFromField: { label: string; hint: string; month?: boolean };
  autoPost?: boolean;
  autoPostField?: { label: string; hint: string };
  options: PostingAccountOption[];
  suggested: boolean;
  canManage: boolean;
  locale: string;
  save: (
    slug: string,
    input: { accounts: Record<string, string>; postFrom: string; autoPost?: boolean },
  ) => Promise<SaveResult>;
  savedDescription: string;
  doneHref: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [postFrom, setPostFrom] = useState(initialFrom);
  const [autoPost, setAutoPost] = useState(initialAuto ?? false);
  const [added, setAdded] = useState<PostingAccountOption[]>([]);
  const [creating, setCreating] = useState<{ key: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  const accounts = useMemo(
    () => added.reduce((list, option) => insertOption(list, option), options),
    [options, added],
  );
  // The clearing account holds money on its way to the bank: assets only.
  const optionsFor = (key: string) =>
    key === clearingKey ? accounts.filter((o) => o.type === "asset") : accounts;

  const created = (key: string, account: NewCategory) => {
    setAdded((list) =>
      insertOption(list, {
        value: account.id,
        label: account.label,
        group: accountTypes[account.type].label,
        type: account.type,
      }),
    );
    if (key === clearingKey && account.type !== "asset") {
      toast.message("Choose an asset for this line", {
        description: `${account.name} is in your chart. ${clearingHint}`,
      });
      return;
    }
    setValues((s) => ({ ...s, [key]: account.id }));
  };

  const submit = () =>
    start(async () => {
      const result = await save(slug, {
        accounts: values,
        postFrom,
        ...(autoPostField ? { autoPost } : {}),
      });
      if (!result.ok) return void toast.error(result.message);
      toast.success("Saved", { description: savedDescription });
      router.push(doneHref);
    });

  let footerNote: ReactNode = null;
  if (postFrom) {
    footerNote = postFromField.month
      ? `From ${new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${postFrom}T00:00:00Z`))}.`
      : `From ${formatDate(postFrom, locale, "long")}.`;
  }

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
                <p className="font-medium text-sm" id={`${idPrefix}-${key}-label`}>
                  {labels[key]}
                </p>
                <p className="mt-0.5 text-muted-foreground text-xs">{hints[key]}</p>
              </div>
              <Combobox
                aria-labelledby={`${idPrefix}-${key}-label`}
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
        <Field label={postFromField.label} htmlFor={`${idPrefix}-from`} hint={postFromField.hint}>
          <Input
            id={`${idPrefix}-from`}
            type={postFromField.month ? "month" : "date"}
            value={postFromField.month ? postFrom.slice(0, 7) : postFrom}
            onChange={(e) =>
              setPostFrom(
                postFromField.month && e.target.value ? `${e.target.value}-01` : e.target.value,
              )
            }
            disabled={!canManage || pending}
          />
        </Field>
        <p className="text-muted-foreground text-xs">
          {footerNote ?? "From the date above."} You choose when each one posts, and can take it
          back out.
        </p>
        {autoPostField ? (
          <div className="grid gap-1.5 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`${idPrefix}-auto`} className="font-medium text-sm">
                {autoPostField.label}
              </label>
              <Switch
                id={`${idPrefix}-auto`}
                checked={autoPost}
                onCheckedChange={setAutoPost}
                disabled={!canManage || pending}
              />
            </div>
            <p className="text-muted-foreground text-xs">{autoPostField.hint}</p>
          </div>
        ) : null}
        {canManage ? (
          <Button onClick={submit} disabled={pending}>
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
              defaultType={newAccount[creating.key]?.type ?? "expense"}
              defaultSubtype={newAccount[creating.key]?.subtype ?? "operating_expense"}
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
