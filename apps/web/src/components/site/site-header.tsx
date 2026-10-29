"use client";

import { SIGN_IN, SITE_NAV, START_FREE, siteHref } from "@bookalyze/core";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { LINK_URLS, SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import { NavMenu, NavMenuList } from "./nav-menu";

const NAV = SITE_NAV.map((l) => ({
  label: l.label,
  href: siteHref(l, "app", LINK_URLS),
  menu: l.menu?.map((m) => ({ label: m.label, hint: m.hint, href: siteHref(m, "app", LINK_URLS) })),
}));

/**
 * The public site's header, on the app's public pages (terms, privacy), so leaving bookalyze.com
 * for them looks like the same place. Links come from `@bookalyze/core` (site), like the site's.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-transparent border-b bg-background/80 backdrop-blur-md transition-colors print:hidden",
        (scrolled || open) && "border-border",
        open && "bg-background",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href={SITE_URL} aria-label="Bookalyze home" className="shrink-0">
          <Brand className="h-7" />
        </a>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) =>
            item.menu ? (
              <NavMenu
                key={item.href}
                label={item.label}
                href={item.href}
                allLabel={`All ${item.label.toLowerCase()}`}
                items={item.menu}
                current={false}
              />
            ) : (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-2 py-2 text-muted-foreground text-sm transition-colors hover:text-foreground lg:px-3"
              >
                {item.label}
              </a>
            ),
          )}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden h-9 sm:inline-flex">
            <Link href={SIGN_IN.path}>{SIGN_IN.label}</Link>
          </Button>
          <Button asChild size="sm" className="h-9">
            <Link href={START_FREE.path}>{START_FREE.label}</Link>
          </Button>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((v) => !v)}
            className="-me-2 inline-flex size-10 items-center justify-center rounded-lg hover:bg-accent md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <nav
          id="site-menu"
          aria-label="Main"
          className="fade-in-0 slide-in-from-top-1 grid animate-in gap-1 border-t px-4 py-3 duration-200 md:hidden"
        >
          {NAV.map((item) =>
            item.menu ? (
              <NavMenuList
                key={item.href}
                label={item.label}
                href={item.href}
                allLabel={`All ${item.label.toLowerCase()}`}
                items={item.menu}
              />
            ) : (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2.5 font-medium text-base hover:bg-accent"
              >
                {item.label}
              </a>
            ),
          )}
          <Link
            href={SIGN_IN.path}
            className="rounded-md px-3 py-2.5 font-medium text-base hover:bg-accent"
          >
            {SIGN_IN.label}
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
