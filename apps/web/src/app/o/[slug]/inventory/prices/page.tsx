import { listingCost } from "@bookalyze/core";
import { amazonSellerId, nextUnitCosts, pricedSkus, schema } from "@bookalyze/db";
import { inArray } from "drizzle-orm";
import { Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { checkPriceChanges } from "@/server/amazon-prices";
import { suggestRate } from "@/server/fx";
import { getInventoryContext } from "@/server/inventory";
import { isOrgAdmin } from "@/server/org";
import { PriceDialog } from "./price-dialog";
import { RefreshPricesButton } from "./refresh-prices-button";
import { SellerIdForm } from "./seller-id-form";

export const metadata: Metadata = { title: "Prices" };

export default async function PricesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getInventoryContext(slug, "inventory.prices");
  const { locale, timezone, baseCurrency } = ctx.profile;
  const today = nowIn(timezone).date;
  const canChange = isOrgAdmin(ctx);
  // Changes Amazon accepted a few minutes ago: see whether they're live yet (briefly).
  await checkPriceChanges(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    Date.now() + 8_000,
  ).catch(() => undefined);

  const { rows, unitCosts, missingSellerIds } = await inOrg(ctx, async (tx) => {
    const rows = await pricedSkus(tx);
    const unitCosts = await nextUnitCosts(tx, [
      ...new Set(rows.flatMap((r) => r.components.map((c) => c.productId))),
    ]);
    const connectionIds = [...new Set(rows.map((r) => r.connectionId))];
    const connections = connectionIds.length
      ? await tx
          .select({ id: schema.connections.id, name: schema.connections.name })
          .from(schema.connections)
          .where(inArray(schema.connections.id, connectionIds))
      : [];
    const missingSellerIds = [];
    for (const c of connections) {
      if (!(await amazonSellerId(tx, c.id))) missingSellerIds.push(c);
    }
    return { rows, unitCosts, missingSellerIds };
  });

  // Costs are in the main currency; a marketplace in another needs today's rate.
  const rates = new Map<string, string | null>();
  for (const currency of new Set(rows.map((r) => r.currency))) {
    if (currency === baseCurrency) continue;
    rates.set(currency, (await suggestRate(baseCurrency, currency, today))?.rate ?? null);
  }
  const channels = [...new Set(rows.map((r) => r.channelName))];
  const checked = rows.filter((r) => r.checkedAt).length;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Inventory"
        title="Prices"
        description="Your Amazon prices next to what each listing costs you. Change a price here and it goes straight to Amazon, with Amazon's fees and your profit shown first."
        actions={rows.length ? <RefreshPricesButton slug={slug} /> : null}
      />

      {missingSellerIds.length && rows.length ? (
        <div className="grid gap-3">
          {missingSellerIds.map((c) => (
            <SellerIdForm
              key={c.id}
              slug={slug}
              connectionId={c.id}
              connectionName={c.name}
              canChange={canChange}
            />
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Tag className="size-6" />
          </span>
          <p className="font-medium">No Amazon listings to price yet</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            Link your Amazon SKUs to products first: their prices then show here, next to what each
            listing costs you.
          </p>
          <Link
            href={`/o/${slug}/inventory/products`}
            className="font-medium text-primary text-sm underline-offset-4 hover:underline"
          >
            Go to Products
          </Link>
        </div>
      ) : (
        <>
          {checked === 0 ? (
            <p className="text-muted-foreground text-sm">
              Press <span className="font-medium text-foreground">Check Amazon for prices</span> to
              bring in each listing's price.
            </p>
          ) : null}
          <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem_8rem_minmax(0,1fr)_7rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
              <span>Product</span>
              <span>SKU</span>
              <span className="text-end">Price</span>
              <span className="text-end">Cost</span>
              <span>Last change</span>
              <span />
            </div>
            <ul className="divide-y">
              {rows.map((r, i) => {
                const cost = listingCost({
                  components: r.components,
                  unitCosts,
                  currency: r.currency,
                  rate: rates.get(r.currency) ?? null,
                });
                const what = r.components
                  .map((c) => (c.units > 1 ? `${c.productName} × ${c.units}` : c.productName))
                  .join(" + ");
                return (
                  <li
                    key={`${r.channelId}:${r.sku}`}
                    aria-label={`${r.sku} on ${r.channelName}`}
                    className="fade-in-0 grid animate-in grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 fill-mode-both px-4 py-3.5 sm:px-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem_8rem_minmax(0,1fr)_7rem]"
                    style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{what}</p>
                      {channels.length > 1 ? (
                        <p className="text-muted-foreground text-xs">{r.channelName}</p>
                      ) : null}
                    </div>
                    <p className="col-start-1 truncate text-muted-foreground text-xs md:col-start-auto md:text-sm">
                      {r.sku}
                    </p>
                    <div className="col-start-2 row-start-1 text-end md:col-start-auto md:row-start-auto">
                      {r.price ? (
                        <Amount
                          value={r.price}
                          currency={r.currency}
                          locale={locale}
                          className="font-medium text-sm"
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {r.found === false
                            ? "Not on Amazon"
                            : r.checkedAt
                              ? "No price"
                              : "Not checked"}
                        </span>
                      )}
                      {r.price && r.checkedAt && !r.status.includes("BUYABLE") ? (
                        <span className="block text-warning text-xs">Not buyable</span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-xs md:text-end md:text-sm">
                      {cost.cost ? (
                        <>
                          <span className="md:hidden">Costs you </span>
                          <Amount value={cost.cost} currency={r.currency} locale={locale} />
                        </>
                      ) : cost.needsRate ? (
                        "No rate yet"
                      ) : (
                        "No cost yet"
                      )}
                    </p>
                    <div className="min-w-0 text-xs">
                      <LastChange change={r.lastChange} currency={r.currency} locale={locale} />
                      {r.problems.length ? (
                        <p className="truncate text-destructive" title={r.problems.join(" ")}>
                          {r.problems[0]}
                        </p>
                      ) : null}
                    </div>
                    <div className="col-span-2 flex justify-end md:col-span-1">
                      {canChange && r.price ? (
                        <PriceDialog
                          slug={slug}
                          channelId={r.channelId}
                          channelName={r.channelName}
                          sku={r.sku}
                          what={what}
                          currency={r.currency}
                          currentPrice={r.price}
                          locale={locale}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-muted-foreground text-xs">
            Cost is what the listing holds, at the cost of the next units to sell (your oldest stock
            lot with units left, freight and duties included). Profit comes from Amazon's own fee
            estimate, shown when you change a price.
          </p>
        </>
      )}
    </div>
  );
}

function LastChange({
  change,
  currency,
  locale,
}: {
  change: Awaited<ReturnType<typeof pricedSkus>>[number]["lastChange"];
  currency: string;
  locale: string;
}) {
  if (!change) return <span className="text-muted-foreground/60">—</span>;
  const price = <Amount value={change.newPrice} currency={currency} locale={locale} />;
  if (change.status === "applied") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="success">Applied</Badge>
        {price}
      </span>
    );
  }
  if (change.status === "sent") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="primary">Updating</Badge>
        {price}
      </span>
    );
  }
  return (
    <span className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="destructive">Not changed</Badge>
        {price}
      </span>
      {change.message ? (
        <span className="line-clamp-2 text-muted-foreground" title={change.message}>
          {change.message}
        </span>
      ) : null}
    </span>
  );
}
