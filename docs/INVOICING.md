# Invoicing: plan

Status: **plan, not built.** Owner asked for it on 2026-10-08. It turns the order-invoice PDF
(phase 3) into an invoicing product of its own. It covers branding, custom invoices, payment
links through Stripe, and a free invoice generator that brings in sign-ups.

## 1. What we have today

- **Order invoices.** A customer PDF for one Amazon order, under Commerce → Order (`order_invoices`,
  `apps/web/src/server/invoice-pdf.ts`).
  - Numbered `INV-0001` per company.
  - "Tax invoice" when the company is registered, otherwise "Invoice" with a "Not registered"
    note.
  - It's a document, not a ledger entry; the books come from settlements.
- **Rendering.** pdf-lib with the built-in Helvetica font: Latin text only, one fixed layout and no
  branding.
- **Already built that invoicing can reuse:**
  - Contacts (customers)
  - Tax rates and registrations (GST/HST, VAT)
  - Currencies and exchange rates
  - The ledger
  - File storage
  - Email (Resend)
  - The settlement deposit-matching engine (for payouts)

## 2. Branding and templates

Your questions: can you upload a letterhead, change the branding, or edit an HTML template?
Yes, in three levels. Each level builds on the one before it.

| Level | What the company does | How it works | When |
| --- | --- | --- | --- |
| **1. Brand settings** | Upload a logo, pick an accent colour and a font, and add a footer (bank details, payment terms, a thank-you line). Optional: show the company name in Arabic. | A **Brand** page under Company. The values go into every template. | First invoicing slice. It also applies to order invoices. |
| **2. Letterhead** | Upload the letterhead as a **PDF** (or a PNG/JPG of the full page). Then set the top and bottom margins the content must stay inside, with a live preview. | The PDF page is drawn as the background of page 1 (and later pages, if chosen). The invoice is written on top, inside the safe area. pdf-lib can embed a PDF page as-is, so the letterhead stays sharp. | First invoicing slice. |
| **3. Templates** | Choose a designed layout: Classic, Modern, Minimal, or **Bilingual EN/AR**. Later, an advanced option: edit the template's HTML/CSS with placeholders such as `{{invoice.number}}` and `{{#lines}}`. | Templates are React components rendered to HTML, then printed to PDF with headless Chromium. The preview on screen and the PDF are then the same page. Custom HTML runs in a sandbox: placeholders only, no scripts, no remote resources except uploaded images. | Designed templates in slice 2. Custom HTML later, only if customers ask for it. |

**Why Chromium for templates.** Moving from pdf-lib to HTML printed by a browser buys four things:
- Real Arabic and right-to-left layout.
- Any web font.
- A preview that matches the PDF exactly.
- One template for screen, email and PDF.

The cost is a heavier serverless function (`@sparticuz/chromium`, about 60 MB) and a cold start
of roughly 1–2 s. That's acceptable for documents. Rendering stays on the server, so the PDF is
the same everywhere.

**Arabic now (before templates).** It's a must-have, so it ships first on the current renderer:
- Embed Noto Sans and Noto Sans Arabic through `@pdf-lib/fontkit`. The fontkit layout joins the
  Arabic letters.
- Reorder right-to-left runs with a bidi step, so names, addresses and product titles read
  correctly.
- When templates move to Chromium, this step goes away.

## 3. Invoicing as a feature (a new module, "Invoicing")

**Documents.** These are the things a company issues to its customers:
- **Invoice:** draft → issued → sent → viewed → partly paid → paid. It can be voided, and it
  becomes overdue after its due date.
- **Quote / estimate:** can be accepted online and turns into an invoice in one click.
- **Credit note:** against an invoice, as a full or partial refund.
- **Recurring invoice:** monthly, quarterly or yearly, sent automatically.
- **Receipt:** sent after payment.

**Building an invoice:**
- **Customer:** picked from contacts, or added on the spot.
- **Lines:** products and services, using Inventory products once they exist plus a services list.
  Each line has quantity, unit price, discount and a tax rate from the company's registrations.
- **Prices:** entered tax-exclusive or tax-inclusive.
- **Currency:** any currency. The rate to the main currency is taken on the invoice date.
- **Numbering:** a per-company prefix and sequence, such as `INV-2026-0001`. It comes from a
  counter that never goes backwards, so a number is never reused. The order invoices move to it
  as well.
- **Dates and notes:** due dates and terms (Due on receipt, Net 15, Net 30), plus notes,
  attachments and a PO number.

**Country rules.** These are built in; nobody has to remember them:
- **UAE:**
  - A "Tax invoice" needs the seller's TRN, the buyer's TRN for B2B, and VAT per line and in
    total.
  - A simplified tax invoice applies below the threshold.
  - Being VAT-registered is the company's setting, as decided on 2026-10-07.
  - **E-invoicing:** the UAE is moving to mandatory Peppol e-invoicing (PINT AE) from 2026–27,
    with dates depending on turnover. We'll check the dates for Kazomo and plan an export.
- **Canada:** GST/HST number, with the required details depending on the invoice amount.
  Ontario HST.

**Sending and the customer's side:**
- **Email:** sent from Bookalyze with the company's name and reply-to, through Resend, with the
  PDF attached.
- **Hosted invoice page:** a link to view and download the PDF. The link can't be guessed and can
  be revoked. It shows when the invoice was viewed and has a **Pay now** button when payments are
  on.
- **Reminders:** sent before and after the due date, on a schedule the company picks. They can be
  switched off per customer.
- **Customer statement:** what a customer owes, with an aging report (current, 30, 60, 90+ days).

**In the books:**
- Issuing an invoice posts Dr Accounts receivable, Cr Sales (and Cr VAT/GST payable).
- A payment posts Dr Bank or Stripe clearing, Cr Accounts receivable.
- A credit note reverses the invoice in part or in full.
- Voiding reverses the entry, so posted entries stay immutable, as everywhere else.
- Paid invoices in another currency post the exchange difference to FX gain or loss. This is the
  same logic as settlements.
- Bank deposits are matched to invoice payments with the deposit-matching engine built for
  settlements.

## 4. Payments with Stripe

**How companies connect: Stripe Connect.** Each company connects **its own Stripe account**
(Standard accounts, through OAuth). The money goes straight to that company. Bookalyze never
holds funds, and refunds and disputes stay in the company's Stripe dashboard. An optional
platform fee can come later as a SaaS revenue line.

**Pilot company: Teknoffice.** Every company already has its own Stripe account. All the
accounts sit under one Stripe login, which Connect allows: each Bookalyze company connects its own
account.

**Not only Stripe.** Payments sit behind one provider interface. Stripe comes first, then the
providers the launch markets need: Razorpay (India: UPI, netbanking), Tap Payments or
Checkout.com (Gulf), and Alipay/WeChat Pay for China. See "Launch markets" in PLAN.md.

**Two ways to collect.** We'd offer one by default and the other as a switch:

| | **A. Our invoice + Stripe Checkout** (recommended default) | **B. Stripe Invoicing** |
| --- | --- | --- |
| What happens | The invoice is ours, with our template, Arabic and letterhead. **Pay now** opens a Stripe Checkout session for the amount due. A partial payment leaves the rest open. | We create the invoice in Stripe, and Stripe hosts the page and sends the emails. |
| Fees | Card processing only. | Card processing **plus** Stripe's per-invoice fee (about 0.4–0.5% of each paid invoice at the time of writing; check current pricing). |
| Branding | Fully ours. | Stripe's layout with a logo and colours; no Arabic layout, no letterhead. |
| Payment methods | Cards, Apple Pay and Google Pay, ACH/PAD bank debits, Link. Whatever the company enables in Stripe. | The same. |
| Best for | Most invoices. | Companies that already run Stripe's invoice emails and want them to stay. |

**Payment links without an invoice.** A reusable "Pay" link for a fixed amount or a product (a
Stripe Payment Link), for deposits or quick sales. Each payment creates a receipt and a sale in the
books.

**Webhooks** (signed and recorded once each):
- `checkout.session.completed` and `payment_intent.succeeded` mark the invoice paid.
- `charge.refunded` creates a credit note or refund entry.
- `charge.dispute.*` flags the invoice.
- `payout.paid` creates a **Stripe payout** that is matched to the bank deposit. Stripe fees post
  to a fees account, like Amazon settlements.

**Without Stripe.** Payment instructions on the invoice: bank transfer (Wise account details),
Interac e-Transfer, and UAE bank or IBAN. A payment can also be recorded by hand, or matched from
the bank feed: "This deposit pays INV-0012?".

## 5. A free invoice generator (lead magnet)

**What the others do:**
- **Adobe Express and Canva:** a design-tool approach with many templates to restyle. The
  output is a pretty PDF with no tax logic.
- **Shopify:** a short form that emails the PDF. It captures the email address and pitches
  Shopify.

**Ours:**
- A public page, `bookalyze.com/tools/invoice-generator`. No sign-up.
- Fill in seller, customer and lines (logo optional), watch a live preview, pick a template and
  download the PDF.
- **What makes it different:** tax-correct for the country chosen.
  - UAE "Tax invoice" with TRN and VAT, and **bilingual English/Arabic**.
  - Canada GST/HST with the right rate per province.
  - Multi-currency.
- **Privacy:** nothing is stored unless the person chooses to. The draft stays in their browser.
  Download and email are rate-limited, and the file carries a small "Made with Bookalyze" footer
  on the free tool.
- **The conversion step.** "Save this invoice, send it, and get paid by card: create a free
  account." The draft, customer and logo come along into a new company.
- **SEO pages:** each targets one search and links to the generator with that preset.
  - Template pages: "UAE tax invoice template", "Canada HST invoice template", "Freelancer
    invoice template", "Amazon seller invoice".
  - Small calculators: VAT and HST, both inclusive and exclusive.
- **Where it lives.** The landing site is static HTML today. The generator needs React, so it
  becomes a public route in the Next.js app, served under the marketing domain. Both run the same
  template components.

## 6. Order of work (each line is roughly one PR)

1. **Now:** Arabic in invoice PDFs (embedded Noto fonts plus bidi). Customer invoices for UAE
   orders then show Arabic names and titles.
2. **Brand settings plus letterhead**, applied to order invoices too.
3. **Invoicing module, core:**
   - customers, lines, tax, numbering counter, draft and issue
   - PDF and email
   - hosted page
   - AR posting, recording a payment, credit note, void
4. **Templates on Chromium:** Classic, Modern, Minimal and Bilingual EN/AR, with a live preview.
5. **Stripe Connect plus Pay now** (Checkout), webhooks, and Stripe payouts matched to bank
   deposits.
6. **Getting paid on time:** quotes, recurring invoices, reminders, statements and an AR aging
   report.
7. **Free invoice generator** plus SEO template pages.
8. **Later:** Stripe Invoicing as an option, custom HTML templates, UAE e-invoicing (Peppol PINT
   AE) export, and a customer portal (all of a customer's invoices).

## 7. Decisions and open questions

- **Decided 2026-10-08:**
  - Invoicing keeps its place in the roadmap, with no rush. Arabic PDFs come first.
  - Teknoffice pilots Stripe, and each company connects its own Stripe account.
  - Launch markets are the USA, India, the Middle East and China, so country rules (US sales tax,
    India GST and e-invoicing, Saudi ZATCA, the Chinese fapiao) come in as data and tax packs.
- **Open:** whether the free generator and invoicing stay free while Stripe payments carry a small
  platform fee, or invoicing becomes part of a paid plan.
