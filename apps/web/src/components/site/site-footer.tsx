import { SITE_FOOTER_COLUMNS, SITE_TAGLINE, SITE_TRADEMARKS, siteHref } from "@bookalyze/core";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { LINK_URLS } from "@/lib/site";

const COLUMNS = SITE_FOOTER_COLUMNS.map((col) => ({
  title: col.title,
  links: col.links.map((l) => ({ label: l.label, href: siteHref(l, "app", LINK_URLS) })),
}));

/** The public site's footer, on the app's public pages. Links from `@bookalyze/core` (site). */
export function SiteFooter() {
  return (
    <footer className="border-t bg-sidebar print:hidden">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="grid content-start gap-3 sm:col-span-2 md:col-span-1">
          <Brand className="h-6" />
          <p className="max-w-xs text-muted-foreground text-sm leading-6">{SITE_TAGLINE}</p>
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
          © {new Date().getFullYear()} Bookalyze. {SITE_TRADEMARKS}
        </p>
      </div>
    </footer>
  );
}
