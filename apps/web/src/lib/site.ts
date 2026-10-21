/** The public site (bookalyze.com), where the shared header and footer links mostly point. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bookalyze.com";

/** Where the shared header and footer links (`@bookalyze/core` site) point from the app. */
export const LINK_URLS = { site: SITE_URL, app: "" };
