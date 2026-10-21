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
import { useEffect } from "react";

/**
 * Remembers where a visitor first came from (utm tags, ad click, referring site) in a cookie on
 * bookalyze.com, so the account made at sign-up can say. The site has its own copy of this.
 */
export function SourceCookie() {
  useEffect(() => {
    const here = window.location;
    const next = sourceFromVisit(here.href, document.referrer, [here.hostname]);
    const existing = decodeSource(readCookie(document.cookie, SOURCE_COOKIE));
    if (!next || !shouldReplace(existing, next)) return;
    const shared = /(^|\.)bookalyze\.com$/.test(here.hostname) ? "; domain=bookalyze.com" : "";
    const secure = here.protocol === "https:" ? "; secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: a plain first-party cookie, read at sign-up
    document.cookie = `${SOURCE_COOKIE}=${encodeSource(next)}; path=/; max-age=${SOURCE_COOKIE_DAYS * 86_400}; samesite=lax${shared}${secure}`;
  }, []);
  return null;
}
