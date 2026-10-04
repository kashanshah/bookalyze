"use client";

import { FILING_FREQUENCY_LABELS, type FilingFrequency } from "@bookalyze/core";
import { Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { deleteTaxRegistrationAction, saveTaxRegistrationAction } from "./actions";

export type EditableRegistration = {
  id: string;
  authority: string;
  registrationNumber: string | null;
  filingFrequency: FilingFrequency;
  effectiveFrom: string | null;
  isActive: boolean;
};

export function RegistrationDialog({
  slug,
  registration,
  defaultAuthority,
  trigger,
}: {
  slug: string;
  registration?: EditableRegistration;
  defaultAuthority?: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        {open ? (
          <RegistrationForm
            slug={slug}
            registration={registration}
            defaultAuthority={defaultAuthority}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RegistrationForm({
  slug,
  registration,
  defaultAuthority,
  onDone,
}: {
  slug: string;
  registration?: EditableRegistration;
  defaultAuthority?: string;
  onDone: () => void;
}) {
  const [frequency, setFrequency] = useState<FilingFrequency>(
    registration?.filingFrequency ?? "quarterly",
  );
  const [active, setActive] = useState(registration?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const text = (key: string) => String(data.get(key) ?? "");
        startTransition(async () => {
          const result = await saveTaxRegistrationAction(slug, {
            id: registration?.id,
            authority: text("authority"),
            registrationNumber: text("registrationNumber"),
            filingFrequency: frequency,
            effectiveFrom: text("effectiveFrom"),
            isActive: active,
          });
          if (result.ok) {
            toast.success(registration ? "Registration saved" : "Registration added");
            onDone();
          } else {
            setErrors(result.errors ?? {});
            if (result.message) toast.error(result.message);
          }
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{registration ? "Edit registration" : "Add a registration"}</DialogTitle>
        <DialogDescription>
          Who you collect sales tax for and how often you file. The sales tax report uses this for
          its filing periods.
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending} className="grid gap-5">
        <Field label="Who you file with" htmlFor="reg-authority" error={errors.authority}>
          <Input
            id="reg-authority"
            name="authority"
            required
            autoFocus
            maxLength={120}
            defaultValue={registration?.authority ?? defaultAuthority ?? ""}
            placeholder="e.g. Canada Revenue Agency (GST/HST)"
          />
        </Field>
        <Field
          label="Registration number (optional)"
          htmlFor="reg-number"
          error={errors.registrationNumber}
          hint="As it appears on your registration letter, e.g. 123456789 RT0001. Printed on your invoices later."
        >
          <Input
            id="reg-number"
            name="registrationNumber"
            maxLength={40}
            defaultValue={registration?.registrationNumber ?? ""}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="How often you file" htmlFor="reg-frequency" error={errors.filingFrequency}>
            <Combobox
              id="reg-frequency"
              value={frequency}
              onChange={(v) => setFrequency(v as FilingFrequency)}
              options={Object.entries(FILING_FREQUENCY_LABELS).map(([key, label]) => ({
                value: key,
                label,
              }))}
            />
          </Field>
          <Field
            label="Registered since (optional)"
            htmlFor="reg-from"
            error={errors.effectiveFrom}
          >
            <Input
              id="reg-from"
              name="effectiveFrom"
              type="date"
              defaultValue={registration?.effectiveFrom ?? ""}
            />
          </Field>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
          <div className="grid gap-1">
            <Label htmlFor="reg-active">Currently registered</Label>
            <p className="text-muted-foreground text-xs">
              Turn off if you've closed this account with the tax authority.
            </p>
          </div>
          <Switch id="reg-active" checked={active} onCheckedChange={setActive} />
        </div>
      </fieldset>
      <DialogFooter className="sm:justify-between">
        {registration ? (
          <Button
            type="button"
            variant={confirmDelete ? "destructive" : "ghost"}
            disabled={pending}
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              startTransition(async () => {
                const result = await deleteTaxRegistrationAction(slug, registration.id);
                if (result.ok) {
                  toast.success("Registration removed");
                  onDone();
                } else toast.error(result.message ?? "Something went wrong");
              });
            }}
          >
            <Trash2 />
            {confirmDelete ? "Click again to remove" : "Remove"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {registration ? "Save changes" : "Add registration"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
