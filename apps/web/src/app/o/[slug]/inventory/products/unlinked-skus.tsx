"use client";

import { PackagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Spinner } from "@/components/ui/spinner";
import { createProductFromSkuAction, linkSkuFromOrdersAction } from "./actions";
import { AmazonSkusButton } from "./amazon-skus-button";
import { BundleDialog } from "./bundle-dialog";

export type UnlinkedSkuView = {
  channelId: string;
  channelName: string;
  sku: string;
  title: string | null;
  orders: number;
  /** Units Amazon holds that can be sold, if its SKUs were brought in. */
  fulfillable: number | null;
};

export function UnlinkedSkus({
  slug,
  rows,
  total,
  products,
}: {
  slug: string;
  rows: UnlinkedSkuView[];
  total: number;
  products: { id: string; name: string }[];
}) {
  return (
    <section
      aria-labelledby="unlinked-title"
      className="fade-in-0 slide-in-from-bottom-1 min-w-0 animate-in rounded-2xl border border-primary/20 bg-primary/[0.03] p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="unlinked-title" className="font-semibold tracking-tight">
            SKUs that aren't linked to a product yet
          </h2>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            From your orders and your Amazon inventory, so variations that haven't sold yet are here
            too. Make a new product from one in one click, or link it to one you already have.
          </p>
        </div>
        <AmazonSkusButton slug={slug} />
      </div>
      <ul className="mt-4 divide-y rounded-xl border bg-card">
        {rows.map((row) => (
          <UnlinkedRow
            key={`${row.channelId}:${row.sku}`}
            slug={slug}
            row={row}
            products={products}
          />
        ))}
      </ul>
      {total > rows.length ? (
        <p className="mt-3 text-muted-foreground text-xs">
          Showing the {rows.length} most recently ordered of {total}. The rest appear as you link
          these.
        </p>
      ) : null}
    </section>
  );
}

function UnlinkedRow({
  slug,
  row,
  products,
}: {
  slug: string;
  row: UnlinkedSkuView;
  products: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState("");
  const input = { channelId: row.channelId, sku: row.sku };

  return (
    <li
      aria-label={row.sku}
      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{row.sku}</p>
        <p className="truncate text-muted-foreground text-xs" title={row.title ?? undefined}>
          {row.channelName}
          {row.title ? ` · ${row.title}` : ""}
        </p>
        <p className="text-muted-foreground text-xs">
          {row.orders ? `${row.orders} ${row.orders === 1 ? "order" : "orders"}` : "No orders yet"}
          {row.fulfillable !== null ? ` · ${row.fulfillable} at Amazon` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await createProductFromSkuAction(slug, input);
              if (result.ok) {
                toast.success(`${result.name} added`, {
                  description: `${row.sku} is linked to it.`,
                });
                router.refresh();
              } else toast.error(result.message);
            })
          }
        >
          {pending ? <Spinner /> : <PackagePlus />}
          Create product
        </Button>
        {products.length ? (
          <Combobox
            value={chosen}
            onChange={(productId) => {
              setChosen(productId);
              const name = products.find((p) => p.id === productId)?.name ?? "the product";
              startTransition(async () => {
                const result = await linkSkuFromOrdersAction(slug, input, productId);
                if (result.ok) {
                  toast.success(`${row.sku} linked to ${name}`);
                  router.refresh();
                } else {
                  setChosen("");
                  toast.error(result.message);
                }
              });
            }}
            options={products.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Link to…"
            searchPlaceholder="Find a product"
            disabled={pending}
            aria-label={`Link ${row.sku} to a product`}
            wrapperClassName="min-w-0 flex-1 sm:w-48 sm:flex-none"
          />
        ) : null}
        {products.length >= 2 ? (
          <BundleDialog
            slug={slug}
            channelId={row.channelId}
            sku={row.sku}
            title={row.title}
            products={products}
          />
        ) : null}
      </div>
    </li>
  );
}
