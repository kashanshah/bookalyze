"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveContactAction } from "./actions";

export type ContactType = "customer" | "vendor" | "both";
export type EditableContact = {
  id: string;
  type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  address: string | null;
  notes: string | null;
};

const TYPES: { key: ContactType; label: string; hint: string }[] = [
  { key: "customer", label: "Customer", hint: "Pays you." },
  { key: "vendor", label: "Vendor", hint: "You pay them." },
  { key: "both", label: "Both", hint: "Buys from you and sells to you." },
];

export function ContactDialog({
  slug,
  contact,
  defaultType = "customer",
  trigger,
}: {
  slug: string;
  contact?: EditableContact;
  defaultType?: ContactType;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        {open ? (
          <ContactForm
            slug={slug}
            contact={contact}
            defaultType={defaultType}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ContactForm({
  slug,
  contact,
  defaultType,
  onDone,
}: {
  slug: string;
  contact?: EditableContact;
  defaultType: ContactType;
  onDone: () => void;
}) {
  const router = useRouter();
  const [type, setType] = useState<ContactType>(contact?.type ?? defaultType);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const text = (key: string) => String(data.get(key) ?? "");
        startTransition(async () => {
          const result = await saveContactAction(slug, {
            id: contact?.id,
            type,
            name: text("name"),
            email: text("email"),
            phone: text("phone"),
            taxNumber: text("taxNumber"),
            address: text("address"),
            notes: text("notes"),
          });
          if (result.ok) {
            toast.success(contact ? "Contact saved" : `${result.data.name} added`);
            onDone();
            if (!contact) router.push(`/o/${slug}/accounting/contacts/${result.data.id}`);
          } else {
            setErrors(result.errors ?? {});
            if (result.message) toast.error(result.message);
          }
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{contact ? "Edit contact" : "Add a customer or vendor"}</DialogTitle>
        <DialogDescription>
          Link transactions to them to see how much you've received from or paid to each one.
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending} className="grid gap-5">
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium text-sm">They are a</legend>
          <div className="grid grid-cols-3 gap-1.5">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={type === t.key}
                onClick={() => setType(t.key)}
                className={cn(
                  "rounded-lg border px-2 py-2 text-start transition-all duration-150",
                  type === t.key
                    ? "border-primary bg-primary/8 shadow-xs"
                    : "hover:border-primary/30 hover:bg-accent",
                )}
              >
                <span className={cn("block font-medium text-sm", type === t.key && "text-primary")}>
                  {t.label}
                </span>
                <span className="block text-muted-foreground text-xs">{t.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Name" htmlFor="contact-name" error={errors.name}>
          <Input
            id="contact-name"
            name="name"
            required
            autoFocus
            defaultValue={contact?.name}
            placeholder={type === "vendor" ? "e.g. Staples" : "e.g. Northwind Traders"}
            aria-invalid={Boolean(errors.name)}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Email (optional)" htmlFor="contact-email" error={errors.email}>
            <Input
              id="contact-email"
              name="email"
              type="email"
              defaultValue={contact?.email ?? ""}
            />
          </Field>
          <Field label="Phone (optional)" htmlFor="contact-phone" error={errors.phone}>
            <Input id="contact-phone" name="phone" type="tel" defaultValue={contact?.phone ?? ""} />
          </Field>
        </div>
        <Field
          label="Tax number (optional)"
          htmlFor="contact-tax"
          error={errors.taxNumber}
          hint="Their GST/HST, VAT or business number, as it appears on their invoices."
        >
          <Input id="contact-tax" name="taxNumber" defaultValue={contact?.taxNumber ?? ""} />
        </Field>
        <Field label="Address (optional)" htmlFor="contact-address" error={errors.address}>
          <Textarea
            id="contact-address"
            name="address"
            rows={2}
            defaultValue={contact?.address ?? ""}
          />
        </Field>
        <Field label="Notes (optional)" htmlFor="contact-notes" error={errors.notes}>
          <Textarea id="contact-notes" name="notes" rows={2} defaultValue={contact?.notes ?? ""} />
        </Field>
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {contact ? "Save changes" : "Add contact"}
        </Button>
      </DialogFooter>
    </form>
  );
}
