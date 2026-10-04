"use client";

import { formatTaxRate } from "@bookalyze/core";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
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
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { saveTaxRateAction } from "./actions";

export type EditableRate = {
  id: string;
  name: string;
  rate: string;
  accountId: string;
  isRecoverable: boolean;
  inUse: boolean;
};

export type TaxAccountOption = { id: string; label: string };

/** Add or edit a tax rate. A rate in use keeps its percentage, account and claim-back setting. */
export function RateDialog({
  slug,
  rate,
  accounts,
  trigger,
}: {
  slug: string;
  rate?: EditableRate;
  accounts: TaxAccountOption[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        {open ? (
          <RateForm slug={slug} rate={rate} accounts={accounts} onDone={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RateForm({
  slug,
  rate,
  accounts,
  onDone,
}: {
  slug: string;
  rate?: EditableRate;
  accounts: TaxAccountOption[];
  onDone: () => void;
}) {
  const [name, setName] = useState(rate?.name ?? "");
  const [percent, setPercent] = useState(rate ? formatTaxRate(rate.rate) : "");
  const [accountId, setAccountId] = useState(rate?.accountId ?? accounts[0]?.id ?? "new");
  const [recoverable, setRecoverable] = useState(rate?.isRecoverable ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fixed = Boolean(rate?.inUse);

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const result = await saveTaxRateAction(slug, {
            id: rate?.id,
            name,
            rate: percent,
            accountId,
            isRecoverable: recoverable,
          });
          if (result.ok) {
            toast.success(rate ? "Tax rate saved" : `${name.trim()} added`);
            onDone();
          } else {
            setErrors(result.errors ?? {});
            setFormError(result.message ?? null);
          }
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{rate ? "Edit tax rate" : "Add a tax rate"}</DialogTitle>
        <DialogDescription>
          Pick this rate on a transaction and the tax included in the amount is split out for your
          return.
        </DialogDescription>
      </DialogHeader>
      {fixed ? (
        <Alert>
          Transactions already use this rate, so only its name can change. For a new percentage, add
          another rate and archive this one.
        </Alert>
      ) : null}
      <fieldset disabled={pending} className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field label="Name" htmlFor="rate-name" error={errors.name}>
            <Input
              id="rate-name"
              required
              autoFocus
              value={name}
              maxLength={80}
              placeholder="e.g. HST 13%"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Rate" htmlFor="rate-percent" error={errors.rate}>
            <div className="relative">
              <Input
                id="rate-percent"
                required
                inputMode="decimal"
                value={percent}
                disabled={fixed}
                placeholder="13"
                className="tabular pe-8 text-end"
                onChange={(e) => setPercent(e.target.value)}
              />
              <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                %
              </span>
            </div>
          </Field>
        </div>
        <Field
          label="Where the tax is kept"
          htmlFor="rate-account"
          error={errors.accountId}
          hint="A liability account for tax collected, less tax you can claim back. Rates you file together share one."
        >
          <Combobox
            id="rate-account"
            value={accountId}
            disabled={fixed}
            onChange={setAccountId}
            options={[
              ...accounts.map((a) => ({ value: a.id, label: a.label })),
              {
                value: "new",
                label: `New account: ${name.trim() ? `${name.trim()} payable` : "named after this rate"}`,
              },
            ]}
          />
        </Field>
        <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
          <div className="grid gap-1">
            <Label htmlFor="rate-recoverable">You can claim back tax you pay</Label>
            <p className="text-muted-foreground text-xs">
              On for GST/HST and VAT (input tax credits). Off for taxes like BC PST, which stay part
              of what you paid.
            </p>
          </div>
          <Switch
            id="rate-recoverable"
            checked={recoverable}
            disabled={fixed}
            onCheckedChange={setRecoverable}
          />
        </div>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {rate ? "Save changes" : "Add rate"}
        </Button>
      </DialogFooter>
    </form>
  );
}
