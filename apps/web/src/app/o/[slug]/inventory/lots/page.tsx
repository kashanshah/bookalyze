import { divideDecimals, purchaseOrderNumber, sumDecimals } from "@bookalyze/core";
import { type LotRow, listLots, listProducts } from "@bookalyze/db";
import { Layers, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Input } from "@/components/ui/input";
import { formatDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { OpeningStockDialog, RemoveOpeningStock } from "./opening-stock";

export const metadata: Metadata = { title: "Stock lots" };

/** Cost of one, to 4 places, as the person's currency. */
function unitCost(lot: { productCost: string; landedCost: string; quantity: number }) {
  return divideDecimals(sumDecimals([lot.productCost, lot.landedCost]), String(lot.quantity), 4);
}

export default async function LotsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const ctx = await getInventoryContext(slug, "inventory.purchasing");
  const { locale } = ctx.profile;
  const { lots, products } = await inOrg(ctx, async (tx) => ({
    lots: await listLots(tx, q ? { search: q } : {}),
    products: (await listProducts(tx))
      .filter((p) => !p.isArchived)
      .map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
  }));
  const groups = new Map<string, LotRow[]>();
  for (const lot of lots) groups.set(lot.productId, [...(groups.get(lot.productId) ?? []), lot]);
  const n = new Intl.NumberFormat(locale);
  const perUnit = (currency: string, value: string) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 4,
    }).format(value as unknown as number);
  const base = `/o/${slug}/inventory`;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Inventory"
        title="Stock lots"
        actions={
          products.length ? (
            <OpeningStockDialog
              slug={slug}
              products={products}
              baseCurrency={ctx.profile.baseCurrency}
              today={nowIn(ctx.profile.timezone).date}
            />
          ) : null
        }
        description="Every delivery of a product is a lot, at what it really cost: the order price plus its share of freight, duty and other costs. Sales use the oldest lot first (FIFO) when each month's cost of goods sold is posted."
      />

      <form className="relative w-full sm:w-72" action={`${base}/lots`}>
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={q}
          placeholder="Product, SKU or supplier"
          aria-label="Search stock lots"
          className="ps-9"
        />
      </form>

      {groups.size === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Layers className="size-6" />
          </span>
          <p className="font-medium">{q ? "No lots match." : "No stock lots yet"}</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {q ? (
              "Try another product, SKU or supplier."
            ) : (
              <>
                A lot is created when you record a delivery on a{" "}
                <Link
                  href={`${base}/purchase-orders`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  purchase order
                </Link>
                .
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {[...groups.values()].map((group, gi) => {
            const first = group[0];
            if (!first) return null;
            const units = group.reduce((sum, lot) => sum + lot.quantity, 0);
            const left = group.reduce((sum, lot) => sum + lot.quantity - lot.consumed, 0);
            const currencies = new Set(group.map((lot) => lot.currency));
            const total =
              currencies.size === 1
                ? sumDecimals(group.flatMap((lot) => [lot.productCost, lot.landedCost]))
                : null;
            return (
              <section
                key={first.productId}
                aria-label={first.productName}
                className="fade-in-0 animate-in overflow-hidden rounded-2xl border bg-card fill-mode-both shadow-xs"
                style={{ animationDelay: `${Math.min(gi, 12) * 25}ms` }}
              >
                <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-5 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium">{first.productName}</h2>
                    {first.productSku ? (
                      <p className="text-muted-foreground text-xs">Your SKU {first.productSku}</p>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {n.format(units)} units received
                    {left !== units ? ` · ${n.format(left)} left` : ""}
                    {total ? (
                      <>
                        {" · average "}
                        <span className="font-medium text-foreground">
                          {perUnit(first.currency, divideDecimals(total, String(units), 4))}
                        </span>
                      </>
                    ) : null}
                  </p>
                </header>
                <ol className="divide-y">
                  {group.map((lot, i) => (
                    <li key={lot.id}>
                      <LotRowView
                        lot={lot}
                        index={i}
                        slug={slug}
                        locale={locale}
                        perUnit={perUnit(lot.currency, unitCost(lot))}
                        n={n}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LotRowView({
  lot,
  index,
  slug,
  locale,
  perUnit,
  n,
}: {
  lot: LotRow;
  index: number;
  slug: string;
  locale: string;
  perUnit: string;
  n: Intl.NumberFormat;
}) {
  const left = lot.quantity - lot.consumed;
  const cells = (
    <>
      <span className="hidden text-muted-foreground text-xs tabular-nums sm:block">
        #{index + 1}
      </span>
      <span>{formatDate(lot.receivedOn, locale)}</span>
      <span className="col-span-2 row-start-2 truncate text-muted-foreground text-xs sm:col-span-1 sm:row-start-auto sm:text-sm">
        {lot.source === "opening"
          ? `Opening stock${lot.notes ? ` · ${lot.notes}` : ""}`
          : lot.source === "return"
            ? "Returned by customers"
            : lot.source === "found"
              ? "Found by Amazon"
              : `${purchaseOrderNumber(lot.purchaseOrderNumber ?? 0)} · ${lot.supplierName ?? ""}`}
      </span>
      <span className="hidden text-end tabular-nums sm:block">
        {lot.consumed ? (
          <>
            {n.format(left)}
            <span className="text-muted-foreground text-xs"> of {n.format(lot.quantity)} left</span>
          </>
        ) : (
          n.format(lot.quantity)
        )}
      </span>
      <span className="text-end">
        <span className="font-medium tabular-nums">{perUnit}</span>
        <span className="block text-muted-foreground text-xs">
          {Number(lot.landedCost) > 0 ? (
            <>
              incl. <Amount value={lot.landedCost} currency={lot.currency} locale={locale} /> extra
            </>
          ) : (
            <span className="sm:hidden">
              {lot.consumed
                ? `${n.format(left)} of ${n.format(lot.quantity)} left`
                : `${n.format(lot.quantity)} units`}
            </span>
          )}
        </span>
      </span>
    </>
  );
  const grid =
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-5 py-3 text-sm sm:grid-cols-[2rem_8rem_minmax(0,1fr)_7rem_8rem]";
  if (lot.source !== "receipt") {
    return (
      <div className="flex items-center">
        <div className={`${grid} min-w-0 flex-1 pe-1`}>{cells}</div>
        <div className="w-11 shrink-0 pe-2">
          {lot.source === "opening" && lot.consumed === 0 ? (
            <RemoveOpeningStock
              slug={slug}
              lotId={lot.id}
              label={`opening stock from ${formatDate(lot.receivedOn, locale)}`}
            />
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <Link
      href={`/o/${slug}/inventory/purchase-orders/${lot.purchaseOrderId}/deliveries/${lot.receiptId}`}
      className={`${grid} transition-colors hover:bg-accent/40`}
    >
      {cells}
    </Link>
  );
}
