"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Spinner } from "@/components/ui/spinner";
import { linkSkuFromOrdersAction, setSkuDropshipAction } from "./actions";

export type DropshipSkuView = {
  channelId: string;
  channelName: string;
  sku: string;
  title: string | null;
  orders: number;
};

/** A product a dropship SKU can be linked to; dropship products are offered first. */
export type DropshipLinkChoice = { id: string; name: string; dropship: boolean };

/**
 * SKUs a partner ships: folded away, each with a way back to "not linked", or linked to a
 * product (ideally one the supplier ships, with their price) so its sales and profit count.
 */
export function DropshipSkus({
  slug,
  rows,
  products,
}: {
  slug: string;
  rows: DropshipSkuView[];
  products: DropshipLinkChoice[];
}) {
  return (
    <details className="group rounded-2xl border bg-card px-5 py-4 shadow-xs">
      <summary className="cursor-pointer list-none font-medium text-sm">
        Dropship SKUs ({rows.length})
        <span className="ms-2 font-normal text-muted-foreground">
          A partner ships these, so they're left out of stock and cost of goods sold. Link one to a
          product your supplier ships to see its profit.
        </span>
      </summary>
      <ul className="mt-4 divide-y rounded-xl border">
        {rows.map((row) => (
          <DropshipRow
            key={`${row.channelId}:${row.sku}`}
            slug={slug}
            row={row}
            products={products}
          />
        ))}
      </ul>
    </details>
  );
}

function DropshipRow({
  slug,
  row,
  products,
}: {
  slug: string;
  row: DropshipSkuView;
  products: DropshipLinkChoice[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState("");
  const input = { channelId: row.channelId, sku: row.sku };
  return (
    <li
      aria-label={row.sku}
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{row.sku}</p>
        <p className="truncate text-muted-foreground text-xs" title={row.title ?? undefined}>
          {row.channelName}
          {row.title ? ` · ${row.title}` : ""}
          {` · ${row.orders} ${row.orders === 1 ? "order" : "orders"}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
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
            options={[...products]
              .sort((a, b) => Number(b.dropship) - Number(a.dropship))
              .map((p) => ({
                value: p.id,
                label: p.name,
                group: p.dropship ? "Your supplier ships" : "Other products",
              }))}
            placeholder="Link to…"
            searchPlaceholder="Find a product"
            disabled={pending}
            aria-label={`Link ${row.sku} to a product`}
            wrapperClassName="min-w-0 flex-1 sm:w-48 sm:flex-none"
          />
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setSkuDropshipAction(
                slug,
                { channelId: row.channelId, sku: row.sku },
                false,
              );
              if (result.ok) {
                toast.success(`${row.sku} ships from your stock`, {
                  description: "Link it to a product under SKUs that aren't linked.",
                });
                router.refresh();
              } else toast.error(result.message);
            })
          }
        >
          {pending ? <Spinner /> : <Undo2 />}
          Ships from my stock
        </Button>
      </div>
    </li>
  );
}
