import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Bookalyze collects, why, who processes it, and how to have it deleted.",
};

/** Where privacy questions and deletion requests go. */
const CONTACT = "privacy@bookalyze.com";
const UPDATED = "October 21, 2026";

const sections: LegalSection[] = [
  {
    title: "Who we are",
    body: (
      <p>
        Bookalyze is accounting and online-selling software for businesses, at app.bookalyze.com. It
        is run from Ontario, Canada. This policy covers the app and the accounts people create in
        it. Each business that uses Bookalyze owns its books; we look after them on its behalf.
      </p>
    ),
  },
  {
    title: "What we collect",
    body: (
      <ul>
        <li>
          <strong>Your account:</strong> your name, email address and password (stored only as a
          one-way hash), or your Google profile's name, email and picture if you sign in with
          Google.
        </li>
        <li>
          <strong>Your companies' records:</strong> what you and your teammates enter or upload:
          company details, accounts, transactions, invoices, bills, contacts, products, purchase
          orders, receipts and documents.
        </li>
        <li>
          <strong>Data from services you connect:</strong> when a company connects Amazon, eBay,
          Noon, Wise or another service, we bring in what's needed for its books: orders,
          settlements, payouts, fees, refunds, inventory movements, balances and transactions.
          Orders can include a buyer's name and shipping address where the marketplace provides
          them; we use them only to keep the company's records and invoices.
        </li>
        <li>
          <strong>Usage and security:</strong> sign-in sessions, IP address and browser for
          security, a log of changes made in each company, and anonymous page-view counts.
        </li>
      </ul>
    ),
  },
  {
    title: "How we use it",
    body: (
      <ul>
        <li>To run the service: keep each company's books, reports, invoices and stock.</li>
        <li>To sign you in, keep accounts secure and show who changed what.</li>
        <li>To send emails you need: verification, password resets, invitations and notices.</li>
        <li>To fix problems and improve Bookalyze.</li>
      </ul>
    ),
  },
  {
    title: "What we don't do",
    body: (
      <ul>
        <li>We don't sell or rent personal data, or share it for advertising.</li>
        <li>
          We don't use one company's data for another company, and data from a marketplace is used
          only for the company that connected it.
        </li>
        <li>We don't contact a marketplace's buyers.</li>
      </ul>
    ),
  },
  {
    title: "Connected services",
    body: (
      <>
        <p>
          A company connects a marketplace or bank by agreeing on that service's own page. We
          request only the access we need, mostly read-only (for eBay: orders, finances and account
          details). The access keys these services give us are encrypted before they're saved, and
          are never shown again.
        </p>
        <p>
          You can disconnect a service at any time from the company's settings in Bookalyze, or from
          the service itself. When a seller closes their eBay account, eBay tells us and we
          disconnect it and delete the eBay access we held.
        </p>
      </>
    ),
  },
  {
    title: "Who processes data for us",
    body: (
      <>
        <p>We use these providers to run Bookalyze, each only for its part of the service:</p>
        <ul>
          <li>
            Vercel: hosting the app and the website, and anonymous counts of page views and of steps
            such as signing up (no cookies of their own).
          </li>
          <li>Neon: the database.</li>
          <li>Amazon Web Services: storing receipts and documents.</li>
          <li>Resend: sending email.</li>
          <li>Google: signing in, if you choose it.</li>
        </ul>
        <p>
          Your data may be stored or processed outside your country, including in the United States
          and Canada. We may also disclose data when the law requires it.
        </p>
      </>
    ),
  },
  {
    title: "Keeping it safe",
    body: (
      <p>
        Data is encrypted in transit. Each company's data is kept apart from every other company's
        by the database itself, so one company can never read another's. Saved access keys are
        encrypted, and access is limited to the people a company invites, with the roles it gives
        them.
      </p>
    ),
  },
  {
    title: "Cookies",
    body: (
      <>
        <p>
          We use the cookies needed to keep you signed in and secure, and one more:{" "}
          <code>bkz_src</code> remembers, for 90 days, which campaign link, ad or website first
          brought you to bookalyze.com. If you create an account, we keep that with it, so we can
          tell which of our marketing works. It holds no personal details, and we don't share it.
        </p>
        <p>There are no advertising cookies, and no one else's tracking cookies.</p>
      </>
    ),
  },
  {
    title: "How long we keep it",
    body: (
      <p>
        We keep a company's records while it uses Bookalyze, because businesses must keep their
        books for years (in Canada, generally six). When a company asks us to delete it, we delete
        its data, except what the law requires us to keep. Data from a disconnected marketplace
        account is deleted on request, and at once when that marketplace asks us to.
      </p>
    ),
  },
  {
    title: "Your choices and rights",
    body: (
      <p>
        You can see and correct your details in your account settings. You can ask for a copy of
        your personal data, or ask us to correct or delete it, by writing to{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We'll answer within 30 days. If you're unhappy
        with our answer, you can complain to your privacy regulator; in Canada, that's the Office of
        the Privacy Commissioner.
      </p>
    ),
  },
  {
    title: "Changes",
    body: (
      <p>
        If we change this policy, we'll update the date below, and tell account owners by email
        before any important change takes effect.
      </p>
    ),
  },
  {
    title: "Contact",
    body: (
      <p>
        Questions about privacy: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated={UPDATED}
      intro="Bookalyze keeps the books of the businesses that use it. This page explains, in plain words, what we collect, why, who helps us run the service, and how to have your data deleted."
      sections={sections}
    />
  );
}
