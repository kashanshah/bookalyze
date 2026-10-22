"use client";

import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_DAYS,
  type ConsentChoice,
  decodeSource,
  encodeSource,
  maySetSource,
  readConsent,
  readCookie,
  SOURCE_COOKIE,
  SOURCE_COOKIE_DAYS,
  shouldReplace,
  sourceFromVisit,
} from "@bookalyze/core";
import { track } from "@vercel/analytics";
import { useEffect, useState } from "react";
import { buttonClass } from "./button";

const REOPEN = "bkz:cookie-choices";

let region: Promise<boolean> | null = null;
/** Whether this visitor is asked first (EU, EEA, UK, Switzerland), fetched once per page load. */
function consentNeeded(): Promise<boolean> {
  region ??= fetch("/api/region", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ consent?: boolean }>) : { consent: true }))
    .then((r) => r.consent !== false)
    // If we can't tell, ask: asking someone who needn't be asked is the safe mistake.
    .catch(() => true);
  return region;
}

function setCookie(name: string, value: string, days: number) {
  const here = window.location;
  const shared = /(^|\.)bookalyze\.com$/.test(here.hostname) ? "; domain=bookalyze.com" : "";
  const secure = here.protocol === "https:" ? "; secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: plain first-party cookies, read at sign-up
  document.cookie = `${name}=${value}; path=/; max-age=${days * 86_400}; samesite=lax${shared}${secure}`;
}

/** Remembers where the visitor first came from, if they may be (see `maySetSource`). */
function rememberSource() {
  const here = window.location;
  const next = sourceFromVisit(here.href, document.referrer, [here.hostname]);
  const existing = decodeSource(readCookie(document.cookie, SOURCE_COOKIE));
  if (next && shouldReplace(existing, next)) {
    setCookie(SOURCE_COOKIE, encodeSource(next), SOURCE_COOKIE_DAYS);
  }
}

/**
 * Sign-up analytics on the site:
 * - remembers where a visitor first came from (utm tags, ad click, referring site) in a cookie on
 *   bookalyze.com, which the app keeps with the account made at sign-up; visitors in the EU, the
 *   EEA, the UK and Switzerland are asked first, and nothing is set unless they agree;
 * - counts clicks on any "Start free" link (to the app's /sign-up) in Vercel Analytics (no
 *   cookies), by page and by where on the page.
 */
export function Growth() {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let gone = false;
    const decide = async (reopen = false) => {
      const needed = await consentNeeded();
      if (gone) return;
      const choice = readConsent(document.cookie);
      if (needed && (reopen || !choice)) setAsking(true);
      else if (maySetSource(needed, choice)) rememberSource();
    };
    decide();
    const onReopen = () => decide(true);
    window.addEventListener(REOPEN, onReopen);

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
      track("Start free", { page: window.location.pathname, where });
    };
    document.addEventListener("click", onClick);
    return () => {
      gone = true;
      window.removeEventListener(REOPEN, onReopen);
      document.removeEventListener("click", onClick);
    };
  }, []);

  const answer = (choice: ConsentChoice) => {
    setCookie(CONSENT_COOKIE, choice, CONSENT_COOKIE_DAYS);
    if (choice === "yes") rememberSource();
    // A "no" also forgets a source remembered before.
    else setCookie(SOURCE_COOKIE, "", 0);
    setAsking(false);
  };

  if (!asking) return null;
  return (
    <section
      aria-label="Cookie choice"
      className="fade-in-0 slide-in-from-bottom-4 fixed inset-x-4 bottom-4 z-50 mx-auto grid max-w-md animate-in gap-3 rounded-2xl border bg-card p-4 shadow-lg duration-300 sm:inset-x-auto sm:end-6 sm:bottom-6 sm:p-5"
    >
      <h2 className="font-semibold text-sm">Can we remember how you found us?</h2>
      <p className="text-muted-foreground text-sm leading-6">
        One small cookie notes the link, ad or website that brought you here, so we know which of
        our marketing works. Nothing else, and it's never shared.{" "}
        <a
          href="/privacy-policy"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Privacy policy
        </a>
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass({ size: "sm" })} onClick={() => answer("yes")}>
          That's fine
        </button>
        <button
          type="button"
          className={buttonClass({ size: "sm", variant: "outline" })}
          onClick={() => answer("no")}
        >
          No thanks
        </button>
      </div>
    </section>
  );
}

/** "Cookie choices" in the footer, for visitors who are asked: reopens the question. */
export function CookieChoices() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let gone = false;
    consentNeeded().then((needed) => !gone && setShown(needed));
    return () => {
      gone = true;
    };
  }, []);
  if (!shown) return null;
  return (
    <button
      type="button"
      className="underline-offset-4 hover:text-foreground hover:underline"
      onClick={() => window.dispatchEvent(new Event(REOPEN))}
    >
      Cookie choices
    </button>
  );
}
