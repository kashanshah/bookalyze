import { BILLING_GRACE_DAYS, TRIAL_DAYS } from "@bookalyze/core";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The agreement between Bookalyze and the businesses that use it.",
};

/** Where questions about these terms go. */
const CONTACT = "info@bookalyze.com";
const UPDATED = "October 22, 2026";
const COMPANY = "Teknoffice Technologies Inc.";

const mail = <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

const sections: LegalSection[] = [
  {
    title: "This agreement",
    body: (
      <>
        <p>
          These terms are the agreement between you and {COMPANY}, an Ontario corporation that makes
          Bookalyze ("Bookalyze", "we", "us"), for using the app at app.bookalyze.com and the
          website at bookalyze.com. By creating an account, you agree to them.
        </p>
        <p>
          Bookalyze is for businesses. If you use it for a business, you agree to these terms for
          that business too, and confirm you're allowed to. You must be at least 18.
        </p>
      </>
    ),
  },
  {
    title: "Your account",
    body: (
      <ul>
        <li>Give your real name and an email address you use, and keep your password private.</li>
        <li>
          You're responsible for what happens under your account and for the people you invite to
          your companies, and for the roles you give them.
        </li>
        <li>Tell us straight away at {mail} if you think someone else has used it.</li>
      </ul>
    ),
  },
  {
    title: "Plans and payment",
    body: (
      <ul>
        <li>
          Each company has its own plan, paid monthly or yearly by card through Stripe. Prices are
          in US dollars, per company, as shown on the pricing page and when you choose a plan.
          Prices don't include taxes; where the law requires us to charge sales tax, it's added to
          the invoice.
        </li>
        <li>
          A plan renews automatically at the end of each month or year, and the card is charged
          then, until the plan is cancelled.
        </li>
        <li>
          Changing plan in Plan and billing takes effect at once: a larger plan is charged for the
          rest of the current period, and a smaller one leaves a credit towards the next invoice.
        </li>
        <li>
          If a payment fails, Stripe tries the card again, and Bookalyze shows what to do. After{" "}
          {BILLING_GRACE_DAYS} days without payment, the features the plan paid for become
          read-only: you can still see and download everything, and nothing is deleted. Paying opens
          them again.
        </li>
        <li>
          We may change prices. We'll email account owners at least 30 days before, and the new
          price applies from the next renewal after that.
        </li>
        <li>
          Payments aren't refunded for part of a month or year, except where the law requires it.
        </li>
      </ul>
    ),
  },
  {
    title: "The free trial and cancelling",
    body: (
      <>
        <p>
          An owner's first company is free for {TRIAL_DAYS} days, with everything included. A card
          is asked for at the start, and is first charged when the free days end, for the plan the
          company has then. Each owner gets one free trial; further companies start on their plan,
          and are charged at once.
        </p>
        <p>
          You can cancel any time in Plan and billing. Cancel during the free trial and nothing is
          charged. After that, the plan stops at the end of the period you've paid for, and its
          features become read-only then. Companies set up before cards were asked for keep their
          free period, and their owners are asked for a card before it ends.
        </p>
      </>
    ),
  },
  {
    title: "Your data",
    body: (
      <>
        <p>
          Your companies' books, files and records belong to you. You give us permission to store
          and process them only to run Bookalyze for you, as described in our{" "}
          <Link href="/privacy-policy">Privacy policy</Link>; for that data, we act on your behalf.
          You can download your reports at any time. If your business needs a data processing
          agreement with us, write to {mail}.
        </p>
        <p>
          Only upload or connect what you have the right to, and use anything a marketplace gives
          you (such as a buyer's name and address) only as that marketplace allows.
        </p>
      </>
    ),
  },
  {
    title: "Marketplaces, banks and other services",
    body: (
      <>
        <p>
          When you connect Amazon, Walmart, Noon, eBay, Wise or another service, you do it with your
          own account there, and that service's own terms and policies also apply to you. Bookalyze
          isn't made or endorsed by them.
        </p>
        <p>
          You're responsible for following those rules in what you ask Bookalyze to do for you. For
          example, review requests are sent through Amazon's own tools when you choose, and Amazon's
          rules on contacting buyers apply to them.
        </p>
        <p>
          We depend on what these services send us, so if one is down, changes how it works, or
          sends something wrong, figures in Bookalyze can be late or need correcting. A service can
          also withdraw access on its side. You can disconnect a service at any time.
        </p>
      </>
    ),
  },
  {
    title: "Not professional advice",
    body: (
      <p>
        Bookalyze helps you keep your books, but it isn't an accountant, tax adviser or lawyer. You
        remain responsible for your records, tax returns and filings, and for checking the figures
        you rely on. Ask a professional when you're unsure.
      </p>
    ),
  },
  {
    title: "Fair use",
    body: (
      <ul>
        <li>
          Don't use Bookalyze for anything unlawful, or for someone else's data without the right
          to.
        </li>
        <li>
          Don't try to reach other companies' data, break or test our security without our written
          permission, or overload the service.
        </li>
        <li>
          Don't copy, resell or reverse-engineer the service, or use it to build a competing one.
        </li>
        <li>Don't send spam or harass anyone through it, including a marketplace's buyers.</li>
      </ul>
    ),
  },
  {
    title: "Ours",
    body: (
      <p>
        Bookalyze, its software, design and content belong to us. These terms let you use it while
        your account is open; they don't give you any other rights in it. If you send us ideas or
        feedback, we may use them without owing you anything.
      </p>
    ),
  },
  {
    title: "Ending",
    body: (
      <>
        <p>
          You can stop using Bookalyze and ask us to delete your account or a company at any time.
          Download what you need first: after deletion, data is kept only where the law requires, as
          the <Link href="/privacy-policy">Privacy policy</Link> explains.
        </p>
        <p>
          We may suspend or close an account that breaks these terms, doesn't pay, or puts others at
          risk, and will tell you why unless the law prevents it. If we ever stop offering
          Bookalyze, we'll give account owners at least 60 days' notice to download their data.
        </p>
      </>
    ),
  },
  {
    title: "Our responsibility",
    body: (
      <>
        <p>
          We work hard to keep Bookalyze accurate, secure and available, but it is provided as it
          is, without promises that it will always be available, meet every need, or be free of
          errors.
        </p>
        <p>
          As far as the law allows, we aren't liable for indirect or consequential losses, such as
          lost profits, revenue or data, or penalties for late or wrong filings. Our total liability
          for any claim is limited to the greater of what you paid us in the 12 months before it and
          US$100.
        </p>
        <p>
          You'll cover our reasonable losses and costs if a claim is brought against us because of
          data you put in Bookalyze without the right to, or your breaking these terms or a
          marketplace's rules.
        </p>
        <p>Nothing in these terms limits rights or liability the law doesn't allow us to limit.</p>
      </>
    ),
  },
  {
    title: "Law",
    body: (
      <p>
        These terms are governed by the laws of Ontario and the federal laws of Canada that apply
        there, and disputes go to the courts of Ontario, unless the law where you are says
        otherwise.
      </p>
    ),
  },
  {
    title: "Changes",
    body: (
      <p>
        If we change these terms, we'll update the date below. For an important change, we'll email
        account owners at least 30 days before it takes effect. Using Bookalyze after that means you
        accept the new terms; if you don't, you can cancel before then.
      </p>
    ),
  },
  {
    title: "The rest",
    body: (
      <p>
        These terms and the Privacy policy are the whole agreement between us about Bookalyze. If a
        part can't be enforced, the rest still applies. Not enforcing a part straight away doesn't
        mean we've given it up. You can't transfer this agreement without our consent; we may
        transfer it to a company that takes over Bookalyze. Neither of us is responsible for delays
        caused by events beyond reasonable control, such as outages at our providers or the services
        you connect.
      </p>
    ),
  },
  {
    title: "Contact",
    body: (
      <p>
        {COMPANY}, Ontario, Canada. Questions about these terms: {mail}.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated={UPDATED}
      intro="The rules for using Bookalyze, in plain words: what you can expect from us, and what we ask of you."
      sections={sections}
    />
  );
}
