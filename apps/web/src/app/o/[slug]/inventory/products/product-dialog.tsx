"use client";

import { Archive, ArchiveRestore, Link2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  linkSkuAction,
  saveProductAction,
  setProductArchivedAction,
  unlinkSkuAction,
} from "./actions";

export type LinkedSkuView = {
  id: string;
  channelId: string;
  channelName: string;
  sku: string;
  units: number;
};

export type EditableProduct = {
  id: string;
  name: string;
  sku: string | null;
  notes: string | null;
  unitWeight: string | null;
  isArchived: boolean;
  skus: LinkedSkuView[];
};

export type ChannelChoice = { id: string; name: string };

export function ProductDialog({
  slug,
  product,
  channels,
  trigger,
}: {
  slug: string;
  product?: EditableProduct;
  channels: ChannelChoice[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {open ? (
          <div className="grid gap-6">
            <ProductForm slug={slug} product={product} onDone={() => setOpen(false)} />
            {product ? (
              <>
                <Separator />
                <SkuLinks slug={slug} product={product} channels={channels} />
              </>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProductForm({
  slug,
  product,
  onDone,
}: {
  slug: string;
  product?: EditableProduct;
  onDone: () => void;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [archiving, startArchive] = useTransition();

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const text = (key: string) => String(data.get(key) ?? "");
        startTransition(async () => {
          const result = await saveProductAction(
            slug,
            {
              name: text("name"),
              sku: text("sku"),
              notes: text("notes"),
              unitWeight: text("unitWeight"),
            },
            product?.id,
          );
          if (result.ok) {
            toast.success(product ? "Product saved" : `${result.name} added`);
            onDone();
            router.refresh();
          } else {
            setErrors(result.errors ?? {});
            if (!result.errors) toast.error(result.message);
          }
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{product ? "Edit product" : "Add a product"}</DialogTitle>
        <DialogDescription>
          {product
            ? "Change its details, and choose which marketplace SKUs are this product."
            : "Something you sell. Once it's added, link the marketplace SKUs that are this product."}
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending || archiving} className="grid gap-5">
        <Field label="Name" htmlFor="product-name" error={errors.name}>
          <Input
            id="product-name"
            name="name"
            required
            autoFocus={!product}
            defaultValue={product?.name}
            placeholder="e.g. Maple leaf ceramic mug"
            aria-invalid={Boolean(errors.name)}
          />
        </Field>
        <Field
          label="Your SKU (optional)"
          htmlFor="product-sku"
          error={errors.sku}
          hint="Your own code for it, if you use one. Marketplace SKUs are linked separately."
        >
          <Input
            id="product-sku"
            name="sku"
            defaultValue={product?.sku ?? ""}
            aria-invalid={Boolean(errors.sku)}
          />
        </Field>
        <Field
          label="Weight of one (optional)"
          htmlFor="product-weight"
          error={errors.unitWeight}
          hint="Used to split freight by weight. Any unit (kg, lb…), as long as every product uses the same one."
        >
          <Input
            id="product-weight"
            name="unitWeight"
            inputMode="decimal"
            defaultValue={
              product?.unitWeight
                ? product.unitWeight.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
                : ""
            }
            placeholder="e.g. 0.45"
            className="tabular-nums"
            aria-invalid={Boolean(errors.unitWeight)}
          />
        </Field>
        <Field label="Notes (optional)" htmlFor="product-notes" error={errors.notes}>
          <Textarea
            id="product-notes"
            name="notes"
            rows={2}
            defaultValue={product?.notes ?? ""}
            placeholder="e.g. supplier, size or colour"
          />
        </Field>
      </fieldset>
      <DialogFooter className="gap-2 sm:justify-between">
        {product ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending || archiving}
            onClick={() =>
              startArchive(async () => {
                const archived = !product.isArchived;
                const result = await setProductArchivedAction(slug, product.id, archived);
                if (result.ok) {
                  toast.success(archived ? `${product.name} archived` : `${product.name} restored`);
                  onDone();
                  router.refresh();
                } else toast.error(result.message);
              })
            }
          >
            {archiving ? <Spinner /> : product.isArchived ? <ArchiveRestore /> : <Archive />}
            {product.isArchived ? "Restore product" : "Archive product"}
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || archiving}>
            {pending ? <Spinner /> : null}
            {product ? "Save changes" : "Add product"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function SkuLinks({
  slug,
  product,
  channels,
}: {
  slug: string;
  product: EditableProduct;
  channels: ChannelChoice[];
}) {
  const router = useRouter();
  const ids = useId();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [sku, setSku] = useState("");
  const [units, setUnits] = useState("1");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);
  const showChannel = new Set(product.skus.map((s) => s.channelId)).size > 1 || channels.length > 1;

  return (
    <section className="grid gap-4" aria-labelledby={`${ids}-title`}>
      <div>
        <h3 id={`${ids}-title`} className="font-medium text-sm">
          Marketplace SKUs
        </h3>
        <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
          Sales of these SKUs count as this product. If a listing is a pack, say how many units it
          holds.
        </p>
      </div>

      {product.skus.length ? (
        <ul className="grid gap-2">
          {product.skus.map((s) => (
            <li
              key={s.id}
              className="fade-in-0 flex animate-in items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-sm">
                  {s.sku}
                  {s.units > 1 ? (
                    <span className="ms-1.5 text-muted-foreground">×{s.units}</span>
                  ) : null}
                </span>
                <span className="block text-muted-foreground text-xs">
                  {showChannel ? `${s.channelName} · ` : ""}
                  {s.units === 1 ? "1 unit per listing" : `${s.units} units per listing`}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Unlink ${s.sku}`}
                disabled={removing !== null}
                onClick={async () => {
                  setRemoving(s.id);
                  const result = await unlinkSkuAction(slug, s.id);
                  setRemoving(null);
                  if (result.ok) {
                    toast.success(`${s.sku} unlinked`);
                    router.refresh();
                  } else toast.error(result.message);
                }}
              >
                {removing === s.id ? <Spinner /> : <X />}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-3 text-center text-muted-foreground text-sm">
          No marketplace SKUs linked yet.
        </p>
      )}

      {channels.length ? (
        <div className="grid gap-4 rounded-xl border p-4">
          {channels.length > 1 ? (
            <Field label="Marketplace" htmlFor={`${ids}-channel`} error={errors.channelId}>
              <Combobox
                id={`${ids}-channel`}
                value={channelId}
                onChange={setChannelId}
                options={channels.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Choose a marketplace"
                invalid={Boolean(errors.channelId)}
              />
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Field
              label="Marketplace SKU"
              htmlFor={`${ids}-sku`}
              error={errors.sku}
              hint={channels.length === 1 ? `On ${channels[0]?.name}.` : undefined}
            >
              <Input
                id={`${ids}-sku`}
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="e.g. MAPLE-MUG-2PK"
                aria-invalid={Boolean(errors.sku)}
              />
            </Field>
            <Field
              label="Units in one listing"
              htmlFor={`${ids}-units`}
              error={errors.units}
              hint="A 2-pack is 2."
            >
              <Input
                id={`${ids}-units`}
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                step={1}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                aria-invalid={Boolean(errors.units)}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await linkSkuAction(slug, {
                  productId: product.id,
                  channelId,
                  sku,
                  units,
                });
                if (result.ok) {
                  toast.success(`${sku.trim()} linked`);
                  setSku("");
                  setUnits("1");
                  setErrors({});
                  router.refresh();
                } else {
                  setErrors(result.errors ?? { sku: result.message });
                }
              })
            }
          >
            {pending ? <Spinner /> : <Link2 />}
            Link SKU
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Connect a marketplace in Commerce → Channels to link its SKUs here.
        </p>
      )}
    </section>
  );
}
