import type { Guide } from "./types";

/** Invoices for buyers: from the order, buyers' requests by email, your brand and numbering. */
export const INVOICE_GUIDES: readonly Guide[] = [
  {
    slug: "buyer-invoices",
    category: "invoices",
    title: "Create a buyer's invoice and send it through Amazon",
    summary:
      "A tax invoice (or a plain invoice when you're not registered) drawn from the order in seconds, in English and Arabic, and sent to the buyer through Amazon without leaving Bookalyze.",
    sections: [
      {
        heading: "What it is",
        blocks: [
          {
            p: "A PDF for the buyer, made from the order: your company's details, the items, shipping, discounts and the total. It **doesn't post to your books**; the settlement already records the sale.",
          },
          {
            table: {
              head: ["Your company", "The PDF says"],
              rows: [
                [
                  "Has an active sales-tax registration in its own country, with a number",
                  "**Tax invoice** (فاتورة ضريبية), with your TRN or GST number",
                ],
                [
                  "Isn't registered",
                  '**Invoice** (فاتورة) and "Not registered for VAT" (or GST/HST); tax Amazon reported is shown as Amazon\'s',
                ],
              ],
            },
          },
          {
            p: "Arabic names, addresses and titles read correctly inside English lines. The invoice notes that Amazon already collected the payment, and any refund on the order.",
          },
        ],
      },
      {
        heading: "Create it",
        blocks: [
          { where: "Commerce → Orders → an order → Create invoice (owners and admins)" },
          {
            steps: [
              {
                title: "Check the buyer",
                body: "With the **Tax Invoicing** role, Bookalyze asks Amazon for the buyer's name, company and tax number. Their email is never kept. Type the street address if the invoice needs one.",
              },
              {
                title: "Save",
                body: "The first invoice is INV-0001; each one after takes the next number.",
              },
              {
                title: "Send to Amazon",
                body: "Uploads the PDF and sends it to the buyer through Amazon's messaging. The order shows when it was sent and by whom.",
              },
            ],
          },
          {
            note: "Without the Tax Invoicing role the form still works: type the buyer's details yourself. Sending needs the **Buyer Communication** role.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "Correct it",
        blocks: [
          {
            p: "**Correct details** replaces the PDF and keeps the number. Each order has one invoice. **Download** gives you the file, for Seller Central or email.",
          },
        ],
      },
      {
        heading: "Before your first invoice",
        blocks: [
          {
            list: [
              "Your company's **registered address** (Entity & compliance → Profile).",
              "Your sales-tax registration, if you have one (Accounting → Sales tax).",
              "Optional: your logo and letterhead (Entity & compliance → Brand).",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The order shows the invoice number and a Download button",
              "After sending, the order says **Sent** with the date",
              "A buyer's open invoice request closes when you send",
            ],
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [
          {
            list: [
              "Sending through Walmart, Noon or eBay (download the PDF and send it there).",
              "Invoices that post to the books, for sales outside marketplaces.",
            ],
          },
        ],
      },
    ],
    related: ["invoice-requests", "brand-and-invoice-numbers", "sales-tax", "connect-amazon"],
  },
  {
    slug: "invoice-requests",
    category: "invoices",
    title: "Invoice requests: buyers asking for an invoice",
    summary:
      "Amazon sends buyers' invoice requests to your email, not to any API. Forward them to your company's own address and each one appears on its order, waiting for you.",
    sections: [
      {
        heading: "Set up forwarding, once",
        blocks: [
          { where: "Commerce → Invoice requests" },
          {
            steps: [
              {
                title: "Copy your forwarding address",
                body: "It looks like invoices-…@ and belongs to this company only.",
              },
              {
                title: "Add it as a forwarding address in your email",
                body: "In Gmail: Settings → Forwarding and POP/IMAP → Add a forwarding address.",
              },
              {
                title: "Confirm",
                body: "Gmail sends a confirmation code to the address. It shows on the Invoice requests page; paste it back into Gmail.",
              },
              {
                title: "Forward only the requests",
                body: 'Make a filter for emails with the subject "Invoice request from Amazon customer" and forward them.',
              },
            ],
          },
        ],
      },
      {
        heading: "When a request arrives",
        blocks: [
          {
            list: [
              "It's listed on Commerce → Invoice requests, and Home says **N buyers are waiting for an invoice**.",
              "The order shows the request beside **Create invoice**.",
              "Sending the invoice to Amazon closes it.",
              "**Answered** or **Dismiss** closes one you handled elsewhere.",
            ],
          },
          {
            p: "The same email twice changes nothing; a newer request for the same order opens it again.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Gmail's confirmation code on the Invoice requests page",
              "A forwarded request listed with its order number",
              "The request closed after **Send to Amazon**",
            ],
          },
        ],
      },
    ],
    related: ["buyer-invoices", "receipts", "home-needs-attention"],
  },
  {
    slug: "brand-and-invoice-numbers",
    category: "invoices",
    title: "Your brand and invoice numbers",
    summary:
      "Your logo, colour, Arabic name, footer and letterhead on every invoice, with a live preview, and invoice numbers in the format you want.",
    sections: [
      {
        heading: "Your brand",
        blocks: [
          { where: "Entity & compliance → Brand" },
          {
            list: [
              "**Logo** and an **accent colour**.",
              "**Arabic name**, shown beside the English one.",
              "A **footer** line, such as your bank details or a thank-you.",
              "A **letterhead**: a PDF or a full-page image, with space kept at the top and bottom, on the first page or every page.",
            ],
          },
          {
            p: "A sample invoice updates as you change things. Invoices already issued keep the brand they were drawn with.",
          },
        ],
      },
      {
        heading: "Invoice numbers",
        blocks: [
          { where: "Entity & compliance → Brand → Invoice numbers" },
          {
            p: "A prefix and a suffix around a four-digit running number. Use **{YYYY}**, **{YY}** or **{MM}** for the invoice's year and month.",
          },
          {
            table: {
              head: ["Prefix", "Suffix", "Looks like"],
              rows: [
                ["INV-", "", "INV-0042"],
                ["{YYYY}-", "", "2026-0042"],
                ["KZ/", "/{YY}", "KZ/0042/26"],
              ],
            },
          },
          {
            note: "The running number is one sequence for the company, so a number is never used twice. A corrected invoice keeps its number.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The preview shows your logo and letterhead where you expect",
              "The next invoice uses the new number format",
              "An older invoice, downloaded again, looks as it did",
            ],
          },
        ],
      },
    ],
    related: ["buyer-invoices", "company-profile-and-documents"],
  },
];
