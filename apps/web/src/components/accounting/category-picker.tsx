"use client";

import {
  ACCOUNT_TYPES,
  type AccountType,
  accountTypes,
  isMoneyAccountSubtype,
  subtypesOf,
} from "@bookalyze/core";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAccountAction } from "@/app/o/[slug]/accounting/actions";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type CategoryOption = { id: string; label: string };
export type CategoryGroup = { type: AccountType; options: CategoryOption[] };
export type NewCategory = CategoryOption & { type: AccountType; name: string };

/** Which side of the books a category is picked for: decides the order and the new one's type. */
export type CategoryDirection = "in" | "out" | "any";

const ORDER: Record<CategoryDirection, AccountType[]> = {
  out: ["expense", "asset", "liability", "equity", "income"],
  in: ["income", "liability", "equity", "asset", "expense"],
  any: ["expense", "income", "asset", "liability", "equity"],
};

/**
 * Category groups plus the ones added on this screen, so a new category shows in every picker
 * straight away (the page's own list catches up when it refreshes).
 */
export function useCategoryList(initial: CategoryGroup[]) {
  const [added, setAdded] = useState<NewCategory[]>([]);
  const groups = useMemo(() => withAdded(initial, added), [initial, added]);
  const add = useCallback((category: NewCategory) => setAdded((list) => [...list, category]), []);
  return { groups, added, add };
}

function withAdded(groups: CategoryGroup[], added: NewCategory[]): CategoryGroup[] {
  if (!added.length) return groups;
  const out = groups.map((g) => ({ ...g, options: [...g.options] }));
  for (const c of added) {
    if (out.some((g) => g.options.some((o) => o.id === c.id))) continue;
    let group = out.find((g) => g.type === c.type);
    if (!group) {
      group = { type: c.type, options: [] };
      out.push(group);
      out.sort((a, b) => ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type));
    }
    const at = group.options.findIndex((o) => o.label.localeCompare(c.label) > 0);
    group.options.splice(at < 0 ? group.options.length : at, 0, { id: c.id, label: c.label });
  }
  return out;
}

/**
 * The category dropdown for transactions and rules, with "Add a new category" under the list.
 * That opens a small form on top of whatever is open; the new category is chosen once saved.
 */
export function CategoryPicker({
  slug,
  groups,
  value,
  onChange,
  onCreated,
  direction = "any",
  id,
  invalid,
  disabled,
  placeholder = "Choose a category…",
  className,
  wrapperClassName,
  "aria-label": ariaLabel,
}: {
  slug: string;
  groups: CategoryGroup[];
  value: string;
  onChange: (id: string) => void;
  onCreated?: (category: NewCategory) => void;
  direction?: CategoryDirection;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  "aria-label"?: string;
}) {
  const [creating, setCreating] = useState<string | null>(null);
  const order = ORDER[direction];
  const options: ComboboxOption[] = [...groups]
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    .flatMap((group) =>
      group.options.map((o) => ({
        value: o.id,
        label: o.label,
        group: accountTypes[group.type].label,
      })),
    );

  return (
    <>
      <Combobox
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        searchable
        placeholder={placeholder}
        searchPlaceholder="Search categories or codes"
        emptyText="No category matches. Add it as a new one below."
        invalid={invalid}
        disabled={disabled}
        className={className}
        wrapperClassName={wrapperClassName}
        aria-label={ariaLabel}
        footer={(query, close) => (
          <button
            type="button"
            onClick={() => {
              close();
              setCreating(query.trim());
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start font-medium text-primary text-sm transition-colors hover:bg-accent"
          >
            <Plus className="size-4 shrink-0" />
            <span className="min-w-0 truncate">
              {query.trim() ? `Add “${query.trim()}” as a new category` : "Add a new category"}
            </span>
          </button>
        )}
      />
      <Dialog open={creating !== null} onOpenChange={(open) => !open && setCreating(null)}>
        <DialogContent>
          {creating !== null ? (
            <NewCategoryForm
              slug={slug}
              initialName={creating}
              defaultType={direction === "in" ? "income" : "expense"}
              onCancel={() => setCreating(null)}
              onSaved={(category) => {
                setCreating(null);
                onCreated?.(category);
                onChange(category.id);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Types a category can be, likeliest first. Bank, card and cash accounts aren't categories. */
const CATEGORY_TYPES: AccountType[] = ["expense", "income", "asset", "liability", "equity"];
const categorySubtypes = (type: AccountType) =>
  subtypesOf(type).filter((s) => !isMoneyAccountSubtype(s.key));

function NewCategoryForm({
  slug,
  initialName,
  defaultType,
  onCancel,
  onSaved,
}: {
  slug: string;
  initialName: string;
  defaultType: AccountType;
  onCancel: () => void;
  onSaved: (category: NewCategory) => void;
}) {
  const [type, setType] = useState<AccountType>(defaultType);
  const [subtype, setSubtype] = useState(categorySubtypes(defaultType)[0]?.key ?? "");
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function chooseType(next: AccountType) {
    setType(next);
    setSubtype(categorySubtypes(next)[0]?.key ?? "");
    setErrors({});
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        // React bubbles events through portals: keep this from submitting a form underneath.
        event.stopPropagation();
        startTransition(async () => {
          const result = await saveAccountAction(slug, {
            name,
            code,
            type,
            subtype,
            description: "",
            currency: "",
          });
          if (!result.ok) {
            setErrors(result.errors ?? {});
            if (result.message) toast.error(result.message);
            return;
          }
          const trimmed = name.trim();
          const label = code.trim() ? `${code.trim()} · ${trimmed}` : trimmed;
          toast.success(`${trimmed} added`, {
            description: "It's in your chart of accounts and every category list.",
          });
          onSaved({ id: result.data.id, label, name: trimmed, type });
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Add a category</DialogTitle>
        <DialogDescription>
          Categories sort your money on reports. This one is added to your chart of accounts.
        </DialogDescription>
      </DialogHeader>

      <fieldset disabled={pending} className="grid gap-5">
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-medium text-sm">Type</legend>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {CATEGORY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => chooseType(t)}
                className={cn(
                  "rounded-lg border px-2 py-2 font-medium text-[13px] transition-all duration-150",
                  type === t
                    ? "border-primary bg-primary/8 text-primary shadow-xs"
                    : "hover:border-primary/30 hover:bg-accent",
                )}
              >
                {accountTypes[t].label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{accountTypes[type].hint}</p>
          {errors.type ? <p className="text-destructive text-xs">{errors.type}</p> : null}
        </fieldset>

        <Field
          label="What it's for"
          htmlFor="new-category-subtype"
          error={errors.subtype}
          hint="Decides where it appears on your reports."
        >
          <Combobox
            id="new-category-subtype"
            value={subtype}
            onChange={setSubtype}
            options={categorySubtypes(type).map((s) => ({ value: s.key, label: s.label }))}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
          <Field label="Name" htmlFor="new-category-name" error={errors.name}>
            <Input
              id="new-category-name"
              required
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "income" ? "e.g. Consulting income" : "e.g. Shipping supplies"}
              aria-invalid={Boolean(errors.name)}
            />
          </Field>
          <Field label="Code (optional)" htmlFor="new-category-code" error={errors.code}>
            <Input
              id="new-category-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 5250"
              className="font-mono"
              aria-invalid={Boolean(errors.code)}
            />
          </Field>
        </div>
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? <Spinner /> : null}
          Add category
        </Button>
      </DialogFooter>
    </form>
  );
}
