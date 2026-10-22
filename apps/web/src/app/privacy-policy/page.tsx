import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Bookalyze collects, why, who processes it, and how to have it deleted.",
};

/** Where privacy questions and deletion requests go (our privacy officer reads it). */
const CONTACT = "info@bookalyze.com";
const UPDATED = "October 22, 2026";
const COMPANY = "Teknoffice Technologies Inc.";

const mail = <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

const sections: LegalSection[] = [
  {
    title: "Who we are",
    body: (
      <>
        <p>
          Bookalyze is accounting and online-selling software for businesses, at app.bookalyze.com,
          with its website at bookalyze.com. It's made by {COMPANY}, an Ontario corporation
          ("Bookalyze", "we", "us"), which is responsible for the personal data described here.
        </p>
        <p>
          Each business that uses Bookalyze decides what goes into its own books, and owns them. For
          those records, including details of its customers, suppliers and a marketplace's buyers,
          we act on the business's behalf (as its "processor" or "service provider"). Questions
          about them are best sent to that business; we'll help it answer.
        </p>
      </>
    ),
  },
  {
    title: "What we collect",
    body: (
      <ul>
        <li>
          <strong>Your account:</strong> your name, email address and password (stored only as a
          one-way hash), or your Google profile's name, email and picture if you sign in with
          Google, and the companies and roles you have.
        </li>
        <li>
          <strong>Your companies' records:</strong> what you and your teammates enter, upload or
          forward to a company's Bookalyze email address: company details, accounts, transactions,
          invoices, bills, contacts, products, purchase orders, receipts, documents, and emails
          forwarded with their attachments.
        </li>
        <li>
          <strong>Data from services you connect:</strong> when a company connects Amazon, Walmart,
          Noon, eBay, Wise or another service, we bring in what its books need: orders, settlements,
          payouts, fees, refunds, stock movements, balances and transactions. Orders can include a
          buyer's name and shipping address where the marketplace provides them; we use them only
          for that company's records and invoices.
        </li>
        <li>
          <strong>Billing:</strong> the plan each company has and its invoices. Card details go
          straight to Stripe; we never see or store them.
        </li>
        <li>
          <strong>Support:</strong> what you write to us through the contact form, a support ticket
          or email, with your name and email address.
        </li>
        <li>
          <strong>Usage and security:</strong> sign-in sessions with IP address and browser, a log
          of changes made in each company, anonymous counts of page views and of steps such as
          signing up, and, if you allow it, which link, ad or website first brought you to us (see
          Cookies).
        </li>
      </ul>
    ),
  },
  {
    title: "How we use it, and why we may",
    body: (
      <>
        <ul>
          <li>
            To run the service you signed up for: your account, each company's books, reports,
            invoices and stock, and the emails it needs (verification, password resets, invitations,
            reminders and notices). This is needed for our agreement with you.
          </li>
          <li>To take payment and keep our own accounts, as our agreement and the law require.</li>
          <li>
            To keep accounts secure, show who changed what, answer support requests, fix problems
            and improve Bookalyze. We do this because we have a legitimate interest in a safe,
            working service, and it doesn't override your rights.
          </li>
          <li>
            To learn which of our marketing brings people to us. Where the law requires it (in the
            EU, the EEA, the UK and Switzerland), only if you agree; elsewhere, as a legitimate
            interest, with this notice.
          </li>
        </ul>
        <p>
          We don't send marketing emails unless you've agreed to them, and each one would let you
          stop them.
        </p>
      </>
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
        <li>
          We don't contact a marketplace's buyers ourselves. Review requests a seller chooses to
          send go through the marketplace's own tools.
        </li>
        <li>We don't make decisions about people by automated means that affect them legally.</li>
      </ul>
    ),
  },
  {
    title: "Connected services",
    body: (
      <>
        <p>
          A company connects a marketplace or bank by agreeing on that service's own page. We
          request only the access we need, mostly read-only. The access keys these services give us
          are encrypted before they're saved, and are never shown again.
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
            such as signing up (it sets no cookies).
          </li>
          <li>Neon: the database.</li>
          <li>Amazon Web Services: storing receipts and documents.</li>
          <li>Resend: sending email, and receiving the emails forwarded to Bookalyze.</li>
          <li>Stripe: taking payments, and the pages where you give a card and manage a plan.</li>
          <li>Google: signing in, if you choose it.</li>
        </ul>
        <p>
          The marketplaces and banks a company connects aren't our providers: the company shares its
          own data with us from them.
        </p>
      </>
    ),
  },
  {
    title: "Where it's kept",
    body: (
      <p>
        Our providers store and process data mainly in the United States and Canada, so it may leave
        your country. For data from the EU, the EEA, the UK or Switzerland, we rely on Canada's
        adequacy decision where it applies, and otherwise on the Standard Contractual Clauses (and
        the UK's addendum) in our providers' data processing terms. We may also disclose data when
        the law requires it.
      </p>
    ),
  },
  {
    title: "Keeping it safe",
    body: (
      <>
        <p>
          Data is encrypted in transit. Each company's data is kept apart from every other company's
          by the database itself, so one company can never read another's. Saved access keys are
          encrypted, and access is limited to the people a company invites, with the roles it gives
          them.
        </p>
        <p>
          If a breach puts personal data at risk, we'll tell the businesses and people affected, and
          the regulators, as the law requires.
        </p>
      </>
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
        <p>
          In the EU, the EEA, the UK and Switzerland, we ask first, and set it only if you agree; a
          small cookie, <code>bkz_consent</code>, remembers your answer for 180 days. You can change
          it any time with Cookie choices at the foot of bookalyze.com.
        </p>
        <p>There are no advertising cookies, and no one else's tracking cookies.</p>
      </>
    ),
  },
  {
    title: "How long we keep it",
    body: (
      <ul>
        <li>
          Your account, while it's open. A company's records, while it uses Bookalyze: businesses
          must keep their books for years (in Canada, generally six), so we don't delete them on our
          own.
        </li>
        <li>
          When you ask us to delete your account or a company, we delete its data within 30 days,
          except what the law requires us to keep (such as our own invoices). Backup copies expire
          on their own soon after. Where you came from is deleted with your account.
        </li>
        <li>
          Data from a disconnected marketplace account is deleted on request, and at once when that
          marketplace asks us to.
        </li>
        <li>Support messages, for as long as they help us answer you, or until you ask.</li>
      </ul>
    ),
  },
  {
    title: "Your choices and rights",
    body: (
      <>
        <p>
          You can see and correct your details in your account settings. Wherever you live, you can
          ask us for a copy of your personal data, or to correct or delete it, by writing to {mail}.
          Depending on where you are, you may also ask us to send it to you in a common format, to
          limit how we use it, or object to our using it for our legitimate interests, and you can
          withdraw consent at any time. We'll answer within 30 days.
        </p>
        <p>
          If you're unhappy with our answer, you can complain to a privacy regulator: in Canada, the
          Office of the Privacy Commissioner; in the UK, the Information Commissioner's Office; in
          the EU, the data protection authority where you live or work.
        </p>
      </>
    ),
  },
  {
    title: "Children",
    body: (
      <p>
        Bookalyze is for businesses, and isn't meant for anyone under 18. We don't knowingly collect
        children's data.
      </p>
    ),
  },
  {
    title: "Changes",
    body: (
      <p>
        If we change this policy, we'll update the date below, and email account owners before any
        important change takes effect.
      </p>
    ),
  },
  {
    title: "Contact",
    body: (
      <p>
        {COMPANY}, Ontario, Canada. Questions about privacy, and requests about your data, go to our
        privacy officer at {mail}.
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
