import { CONTACT, needsConsent, PRIVACY, siteHref, TERMS } from "@bookalyze/core";
import { headers } from "next/headers";
import { BrandPanel } from "@/components/auth/brand-panel";
import { Brand } from "@/components/brand";
import { SourceCookie } from "@/components/growth/source-cookie";
import { LINK_URLS, SITE_URL } from "@/lib/site";

/** The shared footer's legal and contact links, in one line under the form. */
const AUTH_FOOTER = [TERMS, PRIVACY, CONTACT];

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Vercel's geolocation; in development there's none, and nobody is asked.
  const country = (await headers()).get("x-vercel-ip-country");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <a href={SITE_URL} aria-label="Bookalyze home" className="w-fit">
          <Brand className="h-8" />
        </a>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="fade-in-0 slide-in-from-bottom-2 w-full max-w-[400px] animate-in duration-500">
            {children}
          </div>
        </div>
        <p className="flex flex-wrap gap-x-4 text-muted-foreground text-xs">
          <span>© {new Date().getFullYear()} Bookalyze, by Teknoffice Technologies Inc.</span>
          {AUTH_FOOTER.map((l) => (
            <a key={l.label} href={siteHref(l, "app", LINK_URLS)} className="hover:text-foreground">
              {l.label}
            </a>
          ))}
        </p>
      </div>
      <BrandPanel />
      <SourceCookie consentNeeded={needsConsent(country)} />
    </div>
  );
}
