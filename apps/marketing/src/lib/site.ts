import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The app: where people sign up and sign in. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.bookalyze.com";
/** This site's own address, for canonical links, the sitemap and social cards. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bookalyze.com";

/** Where the shared header and footer links (`@bookalyze/core` site) point from this site. */
export const LINK_URLS = { site: SITE_URL, app: APP_URL };

export const SIGN_UP_URL = `${APP_URL}/sign-up`;
export const SIGN_IN_URL = `${APP_URL}/sign-in`;
export const PRIVACY_URL = `${APP_URL}/privacy-policy`;
export const TERMS_URL = `${APP_URL}/terms`;
export const CONTACT_EMAIL = "hello@bookalyze.com";
