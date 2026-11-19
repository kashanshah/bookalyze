import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let started = false;

/**
 * Site analytics (PostHog): which pages people read, where they come from, where they stop, and
 * which "Start free" buttons they press. Without NEXT_PUBLIC_POSTHOG_KEY it does nothing.
 *
 * `remember` follows the same rule as the source cookie (`maySetSource`): only then is an
 * anonymous visitor ID kept in local storage, so several pages make one visit. Otherwise nothing
 * is stored in the browser and each page is counted on its own. PostHog never sets a cookie here.
 * Recordings mask what's typed into forms. Events go through /ingest on our own domain.
 */
export function startSiteAnalytics(remember: boolean) {
  if (!KEY || typeof window === "undefined") return;
  const persistence = remember ? "localStorage" : "memory";
  if (started) {
    posthog.set_config({ persistence });
    if (!remember) posthog.reset();
    return;
  }
  started = true;
  posthog.init(KEY, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    persistence,
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    capture_pageleave: true,
    session_recording: { maskAllInputs: true },
  });
  // Bookalyze and 3D Box Studio share one PostHog project: this keeps them apart in every report.
  posthog.register({ product: "bookalyze", surface: "site" });
}

export function siteEvent(name: string, properties: Record<string, string>) {
  if (started) posthog.capture(name, properties);
}
