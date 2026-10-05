"use client";

import {
  ACCOUNT_TYPES,
  type AccountType,
  accountTypes,
  getAccountSubtype,
  subtypesOf,
} from "@bookalyze/core";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { type FieldErrors, saveAccountAction } from "../actions";

export type EditableAccount = {
  id: string;
  name: string;
  code: string | null;
  type: AccountType;
  subtype: string;
  description: string | null;
  currency: string | null;
  isSystem: boolean;
  isUsed: boolean;
};

type Props = {
  slug: string;
  baseCurrency: string;
  currencies: { code: string; name: string }[];
  account?: EditableAccount;
  defaultType?: AccountType;
  trigger: React.ReactNode;
};

/** Add or edit an account. Remounts its form on every open so it starts from saved values. */
export function AccountDialog(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        {open ? <AccountForm {...props} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({
  slug,
  baseCurrency,
  currencies,
  account,
  defaultType = "asset",
  onDone,
}: Props & { onDone: () => void }) {
  const [type, setType] = useState<AccountType>(account?.type ?? defaultType);
  const [subtype, setSubtype] = useState(account?.subtype ?? subtypesOf(defaultType)[0]?.key ?? "");
  const [currency, setCurrency] = useState(
    account
      ? (account.currency ?? "")
      : getAccountSubtype(subtype)?.needsCurrency
        ? baseCurrency
        : "",
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const needsCurrency = Boolean(getAccountSubtype(subtype)?.needsCurrency);
  const typeLocked = Boolean(account?.isSystem || account?.isUsed);

  function chooseType(next: AccountType) {
    setType(next);
    const first = subtypesOf(next)[0]?.key ?? "";
    setSubtype(first);
    if (getAccountSubtype(first)?.needsCurrency && !currency) setCurrency(baseCurrency);
  }

  function chooseSubtype(next: string) {
    setSubtype(next);
    if (getAccountSubtype(next)?.needsCurrency && !currency) setCurrency(baseCurrency);
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await saveAccountAction(slug, {
            id: account?.id,
            name: String(data.get("name") ?? ""),
            code: String(data.get("code") ?? ""),
            description: String(data.get("description") ?? ""),
            type,
            subtype,
            currency,
          });
          if (result.ok) {
            toast.success(account ? "Account saved" : "Account added");
            onDone();
          } else {
            setErrors(result.errors ?? {});
            if (result.message) toast.error(result.message);
          }
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{account ? "Edit account" : "Add an account"}</DialogTitle>
        <DialogDescription>
          {account
            ? "Changes apply everywhere this account is used, including past entries."
            : "Accounts are the categories your money is sorted into on reports."}
        </DialogDescription>
      </DialogHeader>

      <fieldset disabled={pending} className="grid gap-5">
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium text-sm">Type</legend>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {ACCOUNT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                disabled={typeLocked && t !== type}
                onClick={() => chooseType(t)}
                className={cn(
                  "rounded-lg border px-2 py-2 font-medium text-[13px] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40",
                  type === t
                    ? "border-primary bg-primary/8 text-primary shadow-xs"
                    : "hover:border-primary/30 hover:bg-accent",
                )}
              >
                {accountTypes[t].label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            {typeLocked
              ? account?.isSystem
                ? "Bookalyze relies on this account, so its type is fixed."
                : "This account already has entries, so its type is fixed."
              : accountTypes[type].hint}
          </p>
          {errors.type ? <p className="text-destructive text-xs">{errors.type}</p> : null}
        </fieldset>

        <Field
          label="What it's for"
          htmlFor="subtype"
          error={errors.subtype}
          hint="Decides where it appears on your reports."
        >
          <Combobox
            id="subtype"
            value={subtype}
            disabled={account?.isSystem}
            onChange={chooseSubtype}
            options={subtypesOf(type).map((s) => ({ value: s.key, label: s.label }))}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
          <Field label="Name" htmlFor="name" error={errors.name}>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              defaultValue={account?.name}
              placeholder={needsCurrency ? "e.g. RBC Chequing" : "e.g. Shipping supplies"}
              aria-invalid={Boolean(errors.name)}
            />
          </Field>
          <Field label="Code (optional)" htmlFor="code" error={errors.code}>
            <Input
              id="code"
              name="code"
              defaultValue={account?.code ?? ""}
              placeholder="e.g. 1010"
              className="font-mono"
              aria-invalid={Boolean(errors.code)}
            />
          </Field>
        </div>

        <Field
          label={needsCurrency ? "Currency" : "Currency (optional)"}
          htmlFor="currency"
          error={errors.currency}
          hint={
            account?.isUsed && currency !== (account.currency ?? "")
              ? "Amounts already recorded stay exactly as they are; only new transactions use the new currency. If they were really in the new currency, correct them on Banking → Bank accounts."
              : needsCurrency
                ? "The currency this account is held in."
                : "Leave as “Any currency” unless this account only ever holds one."
          }
        >
          <Combobox
            id="currency"
            value={currency}
            onChange={setCurrency}
            placeholder="Choose a currency…"
            searchPlaceholder="Search currencies"
            options={[
              ...(needsCurrency ? [] : [{ value: "", label: "Any currency" }]),
              ...currencies.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })),
            ]}
          />
        </Field>

        <Field label="Description (optional)" htmlFor="description" error={errors.description}>
          <Input
            id="description"
            name="description"
            defaultValue={account?.description ?? ""}
            placeholder="A note for you and your accountant"
          />
        </Field>
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {account ? "Save changes" : "Add account"}
        </Button>
      </DialogFooter>
    </form>
  );
}
