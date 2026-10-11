"use client";

import { Plus } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { addSupplierAction } from "./actions";

/**
 * The last row of a vendor dropdown: adds what was typed as a new vendor and picks it, so a
 * shipping company or broker can be added without leaving the form.
 */
function AddVendorRow({
  slug,
  query,
  close,
  onAdded,
}: {
  slug: string;
  query: string;
  close: () => void;
  onAdded: (vendor: { id: string; name: string }) => void;
}) {
  const [pending, start] = useTransition();
  const name = query.trim();
  if (!name) {
    return (
      <p className="flex items-center gap-2 px-2.5 py-2 text-muted-foreground text-sm">
        <Plus className="size-4" />
        Type a name to add a new vendor
      </p>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await addSupplierAction(slug, { name });
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          onAdded({ id: result.id, name: result.name });
          close();
          toast.success(`${result.name} added as a vendor`);
        })
      }
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start font-medium text-primary text-sm transition-colors hover:bg-accent disabled:opacity-60"
    >
      {pending ? <Spinner /> : <Plus className="size-4" />}
      Add “{name}” as a new vendor
    </button>
  );
}

/** A `footer` for a vendor Combobox. */
export function addVendorFooter(
  slug: string,
  onAdded: (vendor: { id: string; name: string }) => void,
) {
  return (query: string, close: () => void) => (
    <AddVendorRow slug={slug} query={query} close={close} onAdded={onAdded} />
  );
}
