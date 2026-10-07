import "server-only";
import {
  formatInvoiceNumber,
  type InvoiceBuyer,
  type InvoiceSeller,
  isAmazonRegion,
  prepareOrderInvoice,
  salesTaxName,
} from "@bookalyze/core";
import {
  deleteOrderInvoice,
  getChannelForSync,
  getEntityDetails,
  getOrder,
  getOrderInvoice,
  insertOrderInvoice,
  listIdentifiers,
  listTaxRegistrations,
  nextInvoiceNumber,
  type Transaction,
  updateOrderInvoice,
} from "@bookalyze/db";
import { nowIn } from "@/lib/dates";
import type { InvoiceBuyerFields, InvoiceDraft } from "@/lib/invoice-draft";
import { inOrg } from "@/server/accounting";
import { AmazonError, orderBuyerIdentity } from "@/server/amazon";
import { type CommerceContext, openAmazonCredentials } from "@/server/commerce";
import { renderOrderInvoicePdf } from "@/server/invoice-pdf";
import { deleteStoredFile, invoiceKey, putStoredFile, storageDriver } from "@/server/storage";

const ROLE_NOTE =
  "Amazon didn't share the buyer's name or tax number. In Seller Central → Develop Apps, give the app the Tax Invoicing role, authorize it again, and paste the new refresh token in Commerce → Channels. You can type the details from the customer's message.";
const UNREACHABLE_NOTE =
  "Amazon couldn't be reached just now. You can type the buyer's name and tax number from their message.";
const EMPTY_NOTE =
  "Amazon didn't have a name or tax number for this order. Add them if the customer sent them.";
const OFFLINE_NOTE =
  "This marketplace isn't connected, so the buyer's name and tax number aren't available from Amazon. You can type them.";

const emptyBuyer = (): InvoiceBuyer => ({
  name: null,
  company: null,
  taxNumber: null,
  address: null,
});

const fields = (buyer: InvoiceBuyer): InvoiceBuyerFields => ({
  name: buyer.name ?? "",
  company: buyer.company ?? "",
  taxNumber: buyer.taxNumber ?? "",
  address: buyer.address ?? "",
});

function dayIn(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const pgCode = (error: unknown) =>
  (error as { code?: string; cause?: { code?: string } }).cause?.code ??
  (error as { code?: string }).code;

async function sellerOf(
  tx: Transaction,
  profile: CommerceContext["profile"],
): Promise<{ seller: InvoiceSeller; missingAddress: boolean }> {
  const details = await getEntityDetails(tx);
  const identifiers = await listIdentifiers(tx);
  const registrations = await listTaxRegistrations(tx);
  const active = registrations.filter((row) => row.isActive);
  const registered = active.length > 0;
  const fromRegistration =
    active.map((row) => row.registrationNumber?.trim()).find((value) => value) ?? null;
  const fromIdentifier =
    identifiers.find((row) => row.kind === "ae_trn" || row.kind === "ca_gst")?.value ?? null;
  const address = details.registeredAddress?.trim() || null;
  return {
    missingAddress: !address,
    seller: {
      legalName: profile.legalName,
      tradeName: profile.tradeName,
      address,
      tradeLicense: identifiers.find((row) => row.kind === "ae_trade_license")?.value ?? null,
      taxNumber: registered ? (fromRegistration ?? fromIdentifier) : null,
      taxName: salesTaxName(profile.countryCode),
      registered,
    },
  };
}

function sellerLines(seller: InvoiceSeller): { label: string; value: string }[] {
  const lines = [
    { label: "Legal name", value: seller.legalName },
    seller.tradeName && seller.tradeName !== seller.legalName
      ? { label: "Trade name", value: seller.tradeName }
      : null,
    { label: "Address", value: seller.address ?? "" },
    seller.tradeLicense ? { label: "Trade license", value: seller.tradeLicense } : null,
    seller.taxNumber
      ? {
          label:
            seller.taxName === "VAT"
              ? "TRN"
              : seller.taxName === "GST/HST"
                ? "GST/HST number"
                : "Tax number",
          value: seller.taxNumber,
        }
      : null,
  ];
  return lines.filter((line): line is { label: string; value: string } => Boolean(line?.value));
}

async function buyerFromAmazon(
  ctx: CommerceContext,
  channelId: string,
  externalId: string,
): Promise<{ buyer: InvoiceBuyer; note: string | null }> {
  const channel = await inOrg(ctx, (tx) => getChannelForSync(tx, channelId));
  const region = String(channel?.connection.settings.region ?? "");
  if (!channel?.connection.secret || channel.connection.status === "disconnected") {
    return { buyer: emptyBuyer(), note: OFFLINE_NOTE };
  }
  if (!isAmazonRegion(region)) return { buyer: emptyBuyer(), note: OFFLINE_NOTE };
  try {
    const creds = openAmazonCredentials(
      ctx.org.id,
      channel.connection.id,
      channel.connection.secret,
    );
    const found = await orderBuyerIdentity(creds, region, externalId);
    const buyer = { ...found, address: null };
    const note = buyer.name || buyer.company || buyer.taxNumber ? null : EMPTY_NOTE;
    return { buyer, note };
  } catch (error) {
    if (error instanceof AmazonError && error.code === "forbidden") {
      return { buyer: emptyBuyer(), note: ROLE_NOTE };
    }
    return { buyer: emptyBuyer(), note: UNREACHABLE_NOTE };
  }
}

/** The dialog's contents. Asks Amazon for the buyer's name and tax number only when none is saved yet. */
export async function loadOrderInvoiceDraft(
  ctx: CommerceContext,
  orderId: string,
): Promise<{ ok: true; draft: InvoiceDraft } | { ok: false; message: string }> {
  const found = await inOrg(ctx, async (tx) => {
    const order = await getOrder(tx, orderId);
    if (!order) return null;
    const invoice = await getOrderInvoice(tx, orderId);
    const seller = await sellerOf(tx, ctx.profile);
    return { order, invoice, seller };
  });
  if (!found) return { ok: false, message: "This order is no longer here." };
  const { order: row, invoice, seller } = found;
  if (!row.items.length || row.order.total == null) {
    return { ok: false, message: "You can create an invoice once Amazon has priced this order." };
  }

  const lookedUp = invoice
    ? { buyer: invoice.snapshot.buyer, note: null as string | null }
    : await buyerFromAmazon(ctx, row.order.channelId, row.order.externalId);
  const preview = prepareOrderInvoice({
    number: invoice ? formatInvoiceNumber(invoice.invoiceNumber) : "INV-0000",
    seller: seller.seller,
    buyer: lookedUp.buyer,
    orderNumber: row.order.externalId,
    marketplace: row.channel.name,
    currency: row.order.currency ?? row.channel.currency,
    purchasedOn: dayIn(row.order.purchasedAt, ctx.profile.timezone),
    invoiceDate: invoice?.snapshot.invoiceDate ?? nowIn(ctx.profile.timezone).date,
    total: row.order.total,
    refunded: row.order.refunded,
    items: row.items.map((item) => ({
      title: item.title,
      sku: item.sku,
      quantity: item.quantityOrdered,
      itemPrice: item.itemPrice,
      itemTax: item.itemTax,
      shippingPrice: item.shippingPrice,
      shippingTax: item.shippingTax,
      promotionDiscount: item.promotionDiscount,
    })),
  });

  return {
    ok: true,
    draft: {
      existingNumber: invoice ? preview.number : null,
      seller: sellerLines(seller.seller),
      missingAddress: seller.missingAddress,
      buyer: fields(lookedUp.buyer),
      amazonNote: lookedUp.note,
      lines: preview.lines,
      shipping: preview.shipping,
      discounts: preview.discounts,
      tax: preview.tax ? { label: preview.tax.label, amount: preview.tax.amount } : null,
      total: preview.total,
      refunded: preview.refunded,
      currency: preview.currency,
      registrationNote: preview.registrationNote,
      title: preview.title,
    },
  };
}

export async function issueOrderInvoice(
  ctx: CommerceContext,
  orderId: string,
  buyer: InvoiceBuyer,
): Promise<
  | {
      ok: true;
      id: string;
      number: string;
      created: boolean;
      before: InvoiceBuyer | null;
    }
  | { ok: false; message: string }
> {
  if (storageDriver() === "none") {
    return { ok: false, message: "File storage isn't set up, so the invoice can't be saved." };
  }

  const id = crypto.randomUUID();
  let issued: {
    id: string;
    number: string;
    key: string;
    bytes: Uint8Array;
    previousKey: string | null;
    created: boolean;
    before: InvoiceBuyer | null;
    restore: {
      snapshot: ReturnType<typeof prepareOrderInvoice>;
      storageKey: string;
      fileName: string;
    } | null;
  };
  try {
    const result = await inOrg(ctx, async (tx) => {
      const order = await getOrder(tx, orderId);
      if (!order) return { ok: false as const, message: "This order is no longer here." };
      if (!order.items.length || order.order.total == null) {
        return {
          ok: false as const,
          message: "You can create an invoice once Amazon has priced this order.",
        };
      }
      const { seller, missingAddress } = await sellerOf(tx, ctx.profile);
      if (missingAddress) {
        return {
          ok: false as const,
          message: "Add the company's registered address before creating an invoice.",
        };
      }
      const existing = await getOrderInvoice(tx, orderId);
      const invoiceNumber = existing
        ? existing.invoiceNumber
        : await nextInvoiceNumber(tx, ctx.org.id);
      const snapshot = prepareOrderInvoice({
        number: formatInvoiceNumber(invoiceNumber),
        seller,
        buyer,
        orderNumber: order.order.externalId,
        marketplace: order.channel.name,
        currency: order.order.currency ?? order.channel.currency,
        purchasedOn: dayIn(order.order.purchasedAt, ctx.profile.timezone),
        invoiceDate: existing?.snapshot.invoiceDate ?? nowIn(ctx.profile.timezone).date,
        total: order.order.total,
        refunded: order.order.refunded,
        items: order.items.map((item) => ({
          title: item.title,
          sku: item.sku,
          quantity: item.quantityOrdered,
          itemPrice: item.itemPrice,
          itemTax: item.itemTax,
          shippingPrice: item.shippingPrice,
          shippingTax: item.shippingTax,
          promotionDiscount: item.promotionDiscount,
        })),
      });
      const bytes = await renderOrderInvoicePdf(snapshot);
      const fileName = `${snapshot.number}.pdf`;
      const invoiceId = existing?.id ?? id;
      const key = invoiceKey(ctx.org.id, invoiceId, fileName);
      if (existing) {
        await updateOrderInvoice(tx, {
          id: existing.id,
          snapshot,
          storageKey: key,
          fileName,
          userId: ctx.session.user.id,
        });
      } else {
        await insertOrderInvoice(tx, {
          id: invoiceId,
          orgId: ctx.org.id,
          orderId,
          invoiceNumber,
          snapshot,
          storageKey: key,
          fileName,
          userId: ctx.session.user.id,
        });
      }
      return {
        ok: true as const,
        id: invoiceId,
        number: snapshot.number,
        key,
        bytes,
        previousKey: existing?.storageKey ?? null,
        created: !existing,
        before: existing?.snapshot.buyer ?? null,
        restore: existing
          ? {
              snapshot: existing.snapshot,
              storageKey: existing.storageKey,
              fileName: existing.fileName,
            }
          : null,
      };
    });
    if (!result.ok) return result;
    issued = result;
  } catch (error) {
    if (pgCode(error) === "23505") {
      return {
        ok: false,
        message: "This order already has an invoice. Refresh the page to download it.",
      };
    }
    throw error;
  }

  try {
    await putStoredFile({ key: issued.key, bytes: issued.bytes, contentType: "application/pdf" });
  } catch {
    await inOrg(ctx, async (tx) => {
      if (issued.restore) {
        await updateOrderInvoice(tx, {
          id: issued.id,
          snapshot: issued.restore.snapshot,
          storageKey: issued.restore.storageKey,
          fileName: issued.restore.fileName,
          userId: ctx.session.user.id,
        });
      } else {
        await deleteOrderInvoice(tx, issued.id);
      }
    }).catch(() => {});
    // A correction that keeps the same storage key must not delete the file the row points at again.
    if (!issued.restore || issued.restore.storageKey !== issued.key) {
      await deleteStoredFile(issued.key).catch(() => {});
    }
    return { ok: false, message: "The invoice file couldn't be saved. Try again." };
  }

  if (issued.previousKey && issued.previousKey !== issued.key) {
    await deleteStoredFile(issued.previousKey).catch(() => {});
  }
  return {
    ok: true,
    id: issued.id,
    number: issued.number,
    created: issued.created,
    before: issued.before,
  };
}
