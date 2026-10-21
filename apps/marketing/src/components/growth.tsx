"use client";

import {
  decodeSource,
  encodeSource,
  readCookie,
  SOURCE_COOKIE,
  SOURCE_COOKIE_DAYS,
  shouldReplace,
  sourceFromVisit,
} from "@bookalyze/core";
import { track } from "@vercel/analytics";
import { useEffect } from "react";

/**
 * Sign-up analytics on the site:
 * - remembers where a visitor first came from (utm tags, ad click, referring site) in a cookie on
 *   bookalyze.com, which the app keeps with the account made at sign-up (the app has its own copy
 *   for people who land on it directly);
 * - counts clicks on any "Start free" link (to the app's /sign-up) in Vercel Analytics, by page
 *   and by where on the page.
 */
export function Growth() {
  useEffect(() => {
    const here = window.location;
    const next = sourceFromVisit(here.href, document.referrer, [here.hostname]);
    const existing = decodeSource(readCookie(document.cookie, SOURCE_COOKIE));
    if (next && shouldReplace(existing, next)) {
      const shared = /(^|\.)bookalyze\.com$/.test(here.hostname) ? "; domain=bookalyze.com" : "";
      const secure = here.protocol === "https:" ? "; secure" : "";
      // biome-ignore lint/suspicious/noDocumentCookie: a plain first-party cookie, read at sign-up
      document.cookie = `${SOURCE_COOKIE}=${encodeSource(next)}; path=/; max-age=${SOURCE_COOKIE_DAYS * 86_400}; samesite=lax${shared}${secure}`;
    }

    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      let path: string;
      try {
        path = new URL(link.href).pathname;
      } catch {
        return;
      }
      if (path !== "/sign-up") return;
      const where = link.closest("header") ? "header" : link.closest("footer") ? "footer" : "page";
      track("Start free", { page: here.pathname, where });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
