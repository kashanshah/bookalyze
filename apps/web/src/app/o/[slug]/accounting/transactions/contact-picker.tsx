"use client";

import { Check, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { saveContactAction } from "../contacts/actions";
import type { ContactOption } from "./types";

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
      <Combobox
        id="tx-contact"
        value={value}
        onChange={onChange}
        options={[
          { value: "", label: `No ${role}` },
          ...options.map((c) => ({ value: c.id, label: c.name })),
        ]}
        searchable={options.length > 5}
        searchPlaceholder={`Search ${role}s`}
        emptyText={`No ${role} with that name yet.`}
        invalid={Boolean(error)}
        footer={(query, close) => (
          <button
            type="button"
            onClick={() => {
              close();
              setName(query.trim());
              setAdding(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start font-medium text-primary text-sm transition-colors hover:bg-accent"
          >
            <Plus className="size-4" />
            {query.trim() ? `Add “${query.trim()}” as a new ${role}` : `Add a new ${role}`}
          </button>
        )}
      />
    </Field>
  );
}
