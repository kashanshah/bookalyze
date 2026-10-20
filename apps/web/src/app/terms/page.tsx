import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The agreement between Bookalyze and the people and businesses that use it.",
};

/** Where questions about these terms go. */
const CONTACT = "hello@bookalyze.com";
const UPDATED = "October 20, 2026";

const sections: LegalSection[] = [
  {
    title: "This agreement",
    body: (
      <p>
        These terms are the agreement between you and Bookalyze for using the app at
        app.bookalyze.com. By creating an account, you agree to them. If you use Bookalyze for a
        business, you agree to them for that business too, and confirm you're allowed to.
      </p>
    ),
  },
  {
    title: "Your account",
    body: (
      <ul>
        <li>Give your real name and an email address you use, and keep your password private.</li>
        <li>You're responsible for what happens under your account and the people you invite.</li>
        <li>
          Tell us straight away at <a href={`mailto:${CONTACT}`}>{CONTACT}</a> if you think someone
          else has used it.
        </li>
      </ul>
    ),
  },
  {
    title: "Your data",
    body: (
      <>
        <p>
          Your companies' books, files and records belong to you. You give us permission to store
          and process them only to run Bookalyze for you, as described in our{" "}
          <Link href="/privacy-policy">Privacy policy</Link>. You can download your reports at any
          time.
        </p>
        <p>
          Only upload what you have the right to, and keep anything a marketplace gives you (such as
          a buyer's address) to the uses that marketplace allows.
        </p>
      </>
    ),
  },
  {
    title: "Marketplaces, banks and other services",
    body: (
      <p>
        When you connect Amazon, eBay, Noon, Wise or another service, that service's own terms also
        apply to you. Bookalyze isn't made or endorsed by them. We depend on what they send us, so
        if a service is down, changes how it works, or sends something wrong, figures in Bookalyze
        can be late or need correcting. You can disconnect a service at any time.
      </p>
    ),
  },
  {
    title: "Early access and pricing",
    body: (
      <p>
        Bookalyze is in early access and free to use. Features may change as we improve them. Paid
        plans will come later: we'll tell account owners by email well before any charge, and
        nothing is charged unless you choose a plan.
      </p>
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
          Don't use Bookalyze for anything unlawful, or for someone else's data without consent.
        </li>
        <li>
          Don't try to reach other companies' data, break our security, or overload the service.
        </li>
        <li>Don't copy, resell or reverse-engineer the service.</li>
      </ul>
    ),
  },
  {
    title: "Ending",
    body: (
      <p>
        You can stop using Bookalyze and ask us to delete your account or a company at any time. We
        may suspend or close an account that breaks these terms or puts others at risk, and will
        tell you why unless the law prevents it. Download what you need first: after deletion, data
        is kept only where the law requires.
      </p>
    ),
  },
  {
    title: "Our responsibility",
    body: (
      <>
        <p>
          We work hard to keep Bookalyze accurate, secure and available, but during early access it
          is provided as it is, without promises that it will always be available or free of errors.
        </p>
        <p>
          As far as the law allows, we aren't liable for indirect losses, such as lost profits or
          data, and our total liability is limited to what you paid us in the 12 months before the
          claim. Nothing here limits rights the law doesn't allow us to limit.
        </p>
      </>
    ),
  },
  {
    title: "Law",
    body: (
      <p>
        These terms are governed by the laws of Ontario and the federal laws of Canada that apply
        there, and disputes go to the courts of Ontario, unless the law where you live says
        otherwise.
      </p>
    ),
  },
  {
    title: "Changes",
    body: (
      <p>
        If we change these terms, we'll update the date below and tell account owners by email
        before an important change takes effect. Using Bookalyze after that means you accept the new
        terms.
      </p>
    ),
  },
  {
    title: "Contact",
    body: (
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
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
