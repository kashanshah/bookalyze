"use client";

import { SIGN_IN, SITE_NAV, START_FREE, siteHref } from "@bookalyze/core";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn, LINK_URLS } from "@/lib/site";
import { Brand } from "./brand";
import { ButtonLink } from "./button";
import { NavMenu, NavMenuList } from "./nav-menu";

const NAV = SITE_NAV.map((l) => ({
  label: l.label,
  href: siteHref(l, "site", LINK_URLS),
  menu: l.menu?.map((m) => ({
    label: m.label,
    hint: m.hint,
    href: siteHref(m, "site", LINK_URLS),
  })),
}));
const SIGN_IN_URL = siteHref(SIGN_IN, "site", LINK_URLS);
const SIGN_UP_URL = siteHref(START_FREE, "site", LINK_URLS);

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Close the menu on navigation; give the bar a border once the page scrolls under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new page
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-transparent border-b bg-background/80 backdrop-blur-md transition-colors",
        (scrolled || open) && "border-border",
        open && "bg-background",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Bookalyze home" className="shrink-0">
          <Brand className="h-7" />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) =>
            item.menu ? (
              <NavMenu
                key={item.href}
                label={item.label}
                href={item.href}
                allLabel={`All ${item.label.toLowerCase()}`}
                items={item.menu}
                current={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                aria-current={
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                    ? "page"
                    : undefined
                }
                className="rounded-md px-2 py-2 text-muted-foreground text-sm transition-colors hover:text-foreground aria-[current=page]:text-foreground lg:px-3"
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <ButtonLink
            href={SIGN_IN_URL}
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            {SIGN_IN.label}
          </ButtonLink>
          <ButtonLink href={SIGN_UP_URL} size="sm">
            {START_FREE.label}
          </ButtonLink>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            className="-me-2 inline-flex size-10 items-center justify-center rounded-lg hover:bg-accent md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <nav
          id="mobile-menu"
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
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2.5 font-medium text-base hover:bg-accent"
              >
                {item.label}
              </Link>
            ),
          )}
          <a
            href={SIGN_IN_URL}
            className="rounded-md px-3 py-2.5 font-medium text-base hover:bg-accent"
          >
            {SIGN_IN.label}
          </a>
        </nav>
      ) : null}
    </header>
  );
}
