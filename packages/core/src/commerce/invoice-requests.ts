/**
 * Buyers' invoice requests. Amazon has no API that reads buyer messages, but it emails the seller
 * each request ("Invoice request from Amazon customer Jessika (Order: 171-…)"). The seller
 * forwards those emails to the company's private address, and these helpers read them.
 */

/** Amazon's order number: 3-7-7 digits. */
const AMAZON_ORDER = /\b(\d{3}-\d{7}-\d{7})\b/;

/** Reply and forward markers mail clients put in front of a subject. */
const SUBJECT_PREFIX = /^\s*((re|fw|fwd|aw|wg|tr|rv)\s*:\s*|\[[^\]]*\]\s*)+/i;

export type InvoiceRequestEmail = { externalOrderId: string; buyerName: string | null };

/**
 * The order (and the buyer's name, when given) an invoice-request email is about, or null when
 * the email is something else. Reads Amazon's English subject; another subject still counts
 * when it names an invoice and carries an Amazon order number.
 */
export function parseInvoiceRequestEmail(input: {
  subject: string | null | undefined;
  text?: string | null;
}): InvoiceRequestEmail | null {
  const subject = (input.subject ?? "").replace(SUBJECT_PREFIX, "").trim();
  const exact =
    /invoice request from amazon customer\s+(.+?)\s*\(\s*order\s*:?\s*(\d{3}-\d{7}-\d{7})\s*\)/i.exec(
      subject,
    );
  if (exact?.[1] && exact[2]) {
    return { externalOrderId: exact[2], buyerName: exact[1].trim().slice(0, 200) || null };
  }
  const mentionsInvoice = /invoice|فاتورة/i.test(subject);
  const order =
    AMAZON_ORDER.exec(subject) ?? (mentionsInvoice ? AMAZON_ORDER.exec(input.text ?? "") : null);
  if (mentionsInvoice && order?.[1]) return { externalOrderId: order[1], buyerName: null };
  return null;
}

/** The forwarding address for a company's inbox token. */
export function invoiceInboxAddress(token: string, domain: string): string {
  return `invoices-${token}@${domain}`;
}

/**
 * The inbox token an email was sent to, from its recipients ("Name <a@b>" or bare addresses),
 * or null when none is one of our forwarding addresses.
 */
export function invoiceInboxToken(recipients: readonly string[], domain: string): string | null {
  const escaped = domain.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`invoices-([a-z0-9]{20,64})@${escaped}`, "i");
  for (const recipient of recipients) {
    const match = pattern.exec(recipient.toLowerCase());
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Whether Amazon's Messaging API lists its invoice message for an order
 * (`getMessagingActionsForOrder`, which answers in HAL: actions under `_links` and `_embedded`).
 */
export function messagingAllowsInvoice(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const body = json as {
    _links?: { actions?: { name?: string; href?: string }[] };
    _embedded?: { actions?: { name?: string; _links?: { self?: { href?: string } } }[] };
  };
  const named = [
    ...(body._links?.actions ?? []).map((a) => a.name ?? a.href ?? ""),
    ...(body._embedded?.actions ?? []).map((a) => a.name ?? a._links?.self?.href ?? ""),
  ];
  return named.some((name) => /sendInvoice|\/messages\/invoice\b/i.test(name));
}
