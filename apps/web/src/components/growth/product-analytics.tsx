"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

let started = false;

/**
 * Product analytics (PostHog), for how Bookalyze is used: which pages, which steps, where people
 * stop. Without NEXT_PUBLIC_POSTHOG_KEY it does nothing.
 *
 * The books are private, so:
 * - nothing is stored in the browser (`persistence: "memory"`): no cookies, no local storage;
 * - autocapture keeps which button or link was clicked, never the text on the page, what's typed,
 *   or element attributes (amounts, names and descriptions stay out);
 * - session recording, surveys and heatmaps are off;
 * - a signed-in person is known by their account ID only (see `AnalyticsIdentity`), never by
 *   their name, email or company.
 * Events go through /ingest on our own domain (next.config.ts), so ad blockers don't drop them.
 */
export function startProductAnalytics() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;
  posthog.init(KEY, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    persistence: "memory",
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    capture_pageleave: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: true,
    disable_surveys: true,
    enable_heatmaps: false,
    capture_dead_clicks: false,
    // The page's address is kept without its query string (searches and filters can hold names).
    before_send: (event) => {
      if (!event) return event;
      for (const key of ["$current_url", "$referrer", "$initial_current_url"]) {
        const value = event.properties?.[key];
        if (typeof value === "string") event.properties[key] = value.split("?")[0];
      }
      return event;
    },
  });
  // Bookalyze and 3D Box Studio share one PostHog project: this keeps them apart in every report.
  posthog.register({ product: "bookalyze", surface: "app" });
}

/** Starts analytics on every page of the app (root layout). */
export function ProductAnalytics() {
  useEffect(() => {
    startProductAnalytics();
  }, []);
  return null;
}

/**
 * Links this visit to the signed-in account, by its ID only. Platform admins are marked, so their
 * own use can be filtered out of reports.
 */
export function AnalyticsIdentity({ userId, internal }: { userId: string; internal: boolean }) {
  useEffect(() => {
    if (!KEY) return;
    startProductAnalytics();
    if (posthog.get_distinct_id() !== userId) posthog.identify(userId, { internal });
  }, [userId, internal]);
  return null;
}
