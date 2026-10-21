/**
 * Where sign-ups come from, and how many get through each step. The site (and the app's sign-up
 * pages) remember a visitor's first source in a cookie on bookalyze.com; the app keeps it with
 * the new account; the admin Growth page counts the funnel.
 */

/** First-party cookie, shared by bookalyze.com and app.bookalyze.com. */
export const SOURCE_COOKIE = "bkz_src";
export const SOURCE_COOKIE_DAYS = 90;

export type SignupSource = {
  /** utm_source, or what an ad click id implies ("google" for gclid). */
  source: string | null;
  medium: string | null;
  campaign: string | null;
  /** The other site's host the visitor came from ("google.com"), never our own. */
  referrer: string | null;
  /** The first page seen, without its query ("/features/review-requests"). */
  landing: string | null;
};

const MAX = 100;

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text ? text.slice(0, MAX) : null;
}

function host(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Ours: bookalyze.com and its subdomains, plus any host given (localhost in development). */
export function isOwnHost(hostname: string, extra: readonly string[] = []): boolean {
  const h = hostname.toLowerCase();
  return h === "bookalyze.com" || h.endsWith(".bookalyze.com") || extra.includes(h);
}

/** What a visit says about where it came from: the address it landed on and the referrer. */
export function sourceFromVisit(
  url: string,
  referrer: string,
  ownHosts: readonly string[] = [],
): SignupSource | null {
  let landed: URL;
  try {
    landed = new URL(url);
  } catch {
    return null;
  }
  const q = landed.searchParams;
  const clickSource = q.has("gclid")
    ? "google"
    : q.has("msclkid")
      ? "bing"
      : q.has("fbclid")
        ? "facebook"
        : null;
  const from = referrer ? host(referrer) : null;
  return {
    source: clean(q.get("utm_source")?.toLowerCase() ?? q.get("ref")?.toLowerCase()) ?? clickSource,
    medium:
      clean(q.get("utm_medium")?.toLowerCase()) ??
      (clickSource && (q.has("gclid") || q.has("msclkid")) ? "cpc" : null),
    campaign: clean(q.get("utm_campaign")),
    referrer: from && !isOwnHost(from, ownHosts) ? clean(from) : null,
    landing: clean(landed.pathname),
  };
}

/** Says something beyond "came straight here". */
export function hasSignal(source: SignupSource | null): boolean {
  return Boolean(source && (source.source || source.referrer || source.campaign));
}

/**
 * First touch wins, except that a direct visit gives way to the first one with a source: someone
 * who typed the address, then came back from an ad, counts for the ad.
 */
export function shouldReplace(existing: SignupSource | null, next: SignupSource | null): boolean {
  if (!next) return false;
  if (!existing) return true;
  return !hasSignal(existing) && hasSignal(next);
}

export function encodeSource(source: SignupSource): string {
  return encodeURIComponent(
    JSON.stringify({
      s: source.source,
      m: source.medium,
      c: source.campaign,
      r: source.referrer,
      l: source.landing,
    }),
  );
}

/** The cookie's value back, or null when it's missing or not ours. */
export function decodeSource(raw: string | null | undefined): SignupSource | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    if (!v || typeof v !== "object") return null;
    return {
      source: clean(v.s),
      medium: clean(v.m),
      campaign: clean(v.c),
      referrer: clean(v.r),
      landing: clean(v.l),
    };
  } catch {
    return null;
  }
}

/** One cookie from a Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** How a source is shown and grouped: the utm source, else the referring site, else Direct. */
export function sourceLabel(source: Pick<SignupSource, "source" | "referrer"> | null): string {
  return source?.source ?? source?.referrer ?? "Direct";
}

export type FunnelStep = { key: string; label: string; count: number };

/** Each step's share of the first step and of the one before, as whole percentages. */
export function funnelRates(steps: readonly FunnelStep[]) {
  const first = steps[0]?.count ?? 0;
  return steps.map((step, i) => {
    const before = i === 0 ? step.count : (steps[i - 1]?.count ?? 0);
    return {
      ...step,
      ofFirst: first ? Math.round((step.count * 100) / first) : null,
      ofPrevious: i === 0 ? null : before ? Math.round((step.count * 100) / before) : null,
    };
  });
}
