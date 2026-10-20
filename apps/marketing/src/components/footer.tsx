import Link from "next/link";
import { CONTACT_EMAIL, PRIVACY_URL, SIGN_IN_URL, SIGN_UP_URL, TERMS_URL } from "@/lib/site";
import { Brand } from "./brand";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Marketplaces", href: "/#marketplaces" },
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Start free", href: SIGN_UP_URL },
      { label: "Sign in", href: SIGN_IN_URL },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Contact", href: `mailto:${CONTACT_EMAIL}` },
      { label: "Terms of service", href: TERMS_URL },
      { label: "Privacy policy", href: PRIVACY_URL },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t bg-sidebar">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="grid content-start gap-3">
          <Brand className="h-6" />
          <p className="max-w-xs text-muted-foreground text-sm leading-6">
            Bookkeeping that connects to Amazon, eBay and Noon, for every company you run.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="font-medium text-sm">{col.title}</h2>
            <ul className="mt-3 grid gap-2 text-muted-foreground text-sm">
              {col.links.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith("/") ? (
                    <Link href={link.href} className="hover:text-foreground">
                      {link.label}
                    </Link>
                  ) : (
                    <a href={link.href} className="hover:text-foreground">
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-6 text-muted-foreground text-xs leading-5 sm:px-6">
          © {new Date().getFullYear()} Bookalyze. Amazon, eBay, Noon and Wise are trademarks of
          their owners; Bookalyze isn't made or endorsed by them.
        </p>
      </div>
    </footer>
  );
}
