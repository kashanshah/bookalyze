"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { saveContactAction } from "../contacts/actions";
import type { ContactOption } from "./types";

const NEW = "__new__";

/**
 * Optional customer (money in) or vendor (money out) for a transaction, with an inline way to
 * add a new one without leaving the form.
 */
export function ContactPicker({
  slug,
  kind,
  value,
  onChange,
  contacts,
  onCreated,
  error,
}: {
  slug: string;
  kind: "deposit" | "withdrawal";
  value: string;
  onChange: (id: string) => void;
  contacts: ContactOption[];
  onCreated: (contact: ContactOption) => void;
  error?: string;
}) {
  const role = kind === "deposit" ? "customer" : "vendor";
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const options = contacts.filter(
    (c) => c.id === value || (!c.isArchived && (c.type === role || c.type === "both")),
  );

  function create() {
    startTransition(async () => {
      const result = await saveContactAction(slug, { type: role, name });
      if (!result.ok) {
        toast.error(result.errors?.name ?? result.message ?? "Couldn't add them.");
        return;
      }
      onCreated(result.data);
      onChange(result.data.id);
      setAdding(false);
      setName("");
      toast.success(`${result.data.name} added`);
    });
  }

  const label = kind === "deposit" ? "Customer (optional)" : "Vendor (optional)";
  if (adding) {
    return (
      <Field label={`New ${role}`} htmlFor="tx-new-contact">
        <div className="flex gap-2">
          <Input
            id="tx-new-contact"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "deposit" ? "e.g. Northwind Traders" : "e.g. Staples"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (name.trim()) create();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setAdding(false);
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            disabled={!name.trim() || pending}
            onClick={create}
            aria-label={`Add ${role}`}
          >
            {pending ? <Spinner /> : <Check />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setAdding(false)}
            aria-label="Cancel"
          >
            <X />
          </Button>
        </div>
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor="tx-contact" error={error}>
      <NativeSelect
        id="tx-contact"
        value={value}
        onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}
      >
        <option value="">No {role}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={NEW}>+ Add a new {role}…</option>
      </NativeSelect>
    </Field>
  );
}
