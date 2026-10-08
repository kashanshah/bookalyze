import {
  inventoryChannels,
  listProducts,
  UNITS_SOLD_DAYS,
  unitsOnOrder,
  unlinkedSkus,
} from "@bookalyze/db";
import { Package, Pencil, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { AmazonSkusButton } from "./amazon-skus-button";
import { ProductDialog } from "./product-dialog";
import { UnlinkedSkus } from "./unlinked-skus";

export const metadata: Metadata = { title: "Products" };

const UNLINKED_SHOWN = 10;

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const showArchived = sp.archived === "1";
  const ctx = await getInventoryContext(slug);
  const { locale } = ctx.profile;
  const { products, channels, unlinked, active, onOrder } = await inOrg(ctx, async (tx) => {
    const channels = await inventoryChannels(tx);
    const [products, unlinked, active] = [
      await listProducts(tx, { search: q || null, includeArchived: showArchived }),
      await unlinkedSkus(tx, { limit: UNLINKED_SHOWN }),
      q || showArchived ? await listProducts(tx) : null,
    ];
    return { products, channels, unlinked, active, onOrder: await unitsOnOrder(tx) };
  });
  const linkable = (active ?? products).filter((p) => !p.isArchived);
  const channelChoices = channels
    .filter((c) => c.isActive)
    .map((c) => ({ id: c.id, name: c.name }));
  // Name the marketplace on each SKU only when the linked SKUs span more than one.
  const manyChannels = new Set(products.flatMap((p) => p.skus.map((s) => s.channelId))).size > 1;
  const base = `/o/${slug}/inventory/products`;
  const href = (next: { q?: string; archived?: boolean }) => {
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.archived) p.set("archived", "1");
    return `${base}${p.size ? `?${p}` : ""}`;
  };
  const number = new Intl.NumberFormat(locale);

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Inventory"
        title="Products"
        description="The things you sell. Link each marketplace SKU to its product, so sales add up per product even when it's listed in packs or on several marketplaces."
        actions={
          <ProductDialog
            slug={slug}
            channels={channelChoices}
            trigger={
              <Button>
                <Plus />
                Add product
              </Button>
            }
          />
        }
      />

      {unlinked.rows.length ? (
        <UnlinkedSkus
          slug={slug}
          rows={unlinked.rows.map((r) => ({
            channelId: r.channelId,
            channelName: r.channelName,
            sku: r.sku,
            title: r.title,
            orders: r.orders,
            fulfillable: r.fulfillable,
          }))}
          total={unlinked.total}
          products={linkable.map((p) => ({ id: p.id, name: p.name }))}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form className="relative w-full sm:w-72" action={base}>
          {showArchived ? <input type="hidden" name="archived" value="1" /> : null}
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search names and SKUs"
            aria-label="Search products"
            className="ps-9"
          />
        </form>
        <Link
          href={href({ q, archived: !showArchived })}
          scroll={false}
          aria-pressed={showArchived}
          className={cn(
            "rounded-lg px-3 py-2 font-medium text-sm transition-colors",
            showArchived
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
        {!unlinked.rows.length && channelChoices.length ? (
          <div className="flex w-full justify-end sm:w-auto">
            <AmazonSkusButton slug={slug} />
          </div>
        ) : null}
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Package className="size-6" />
          </span>
          <p className="font-medium">{q ? "No products match." : "No products yet"}</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {q
              ? "Try another name or SKU."
              : unlinked.rows.length
                ? "Start from the SKUs on your orders above, or add a product by hand."
                : "Add the things you sell. Once your marketplace orders come in, their SKUs show up here to link."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_8rem_2.25rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
            <span>Product</span>
            <span>Marketplace SKUs</span>
            <span className="text-end">Sold, {UNITS_SOLD_DAYS} days</span>
            <span />
          </div>
          <ul className="divide-y">
            {products.map((p, i) => (
              <li
                key={p.id}
                aria-label={p.name}
                className="fade-in-0 grid animate-in grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-2 fill-mode-both px-4 py-3.5 sm:px-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_8rem_2.25rem]"
                style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <span className="truncate font-medium text-sm">{p.name}</span>
                    {p.isArchived ? (
                      <Badge variant="secondary" className="shrink-0">
                        Archived
                      </Badge>
                    ) : null}
                  </p>
                  {p.sku ? (
                    <p className="truncate text-muted-foreground text-xs">Your SKU {p.sku}</p>
                  ) : null}
                </div>
                <div className="col-span-3 row-start-2 flex min-w-0 flex-wrap gap-1.5 md:col-span-1 md:row-start-auto">
                  {p.skus.length ? (
                    p.skus.map((s) => (
                      <Badge
                        key={s.id}
                        variant="primary"
                        title={`${s.channelName}: ${s.units === 1 ? "1 unit" : `${s.units} units`} per listing${s.bundleWith.length ? `, in a bundle with ${s.bundleWith.map((b) => b.name).join(", ")}` : ""}`}
                      >
                        {manyChannels ? (
                          <span className="font-normal opacity-75">{s.channelName}</span>
                        ) : null}
                        {s.sku}
                        {s.units > 1 ? <span className="opacity-75">×{s.units}</span> : null}
                        {s.bundleWith.length ? (
                          <span className="font-normal opacity-75">bundle</span>
                        ) : null}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground text-xs">No SKUs linked yet</span>
                  )}
                </div>
                <p className="col-start-2 row-start-1 text-end text-sm md:col-start-auto md:row-start-auto">
                  <span className="font-medium tabular-nums">{number.format(p.unitsSold30d)}</span>
                  <span className="block text-muted-foreground text-xs md:hidden">
                    sold in {UNITS_SOLD_DAYS} days
                  </span>
                  {onOrder.get(p.id) ? (
                    <span className="block text-primary text-xs">
                      {number.format(onOrder.get(p.id) ?? 0)} on order
                    </span>
                  ) : null}
                </p>
                <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                  <ProductDialog
                    slug={slug}
                    channels={channelChoices}
                    product={{
                      id: p.id,
                      name: p.name,
                      sku: p.sku,
                      notes: p.notes,
                      unitWeight: p.unitWeight,
                      isArchived: p.isArchived,
                      skus: p.skus,
                    }}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`}>
                        <Pencil />
                      </Button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
