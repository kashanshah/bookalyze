/**
 * The guides (bookalyze.com/guides): how Bookalyze works, written for sellers. Each guide is
 * data, so the index can search it and every guide looks the same. Text may use **bold**.
 * Keep every guide true to the app (docs/STATUS.md): name screens the way the app does
 * ("Commerce → Settlements"), and say what isn't built yet rather than leave it out.
 */

export type Block =
  /** A paragraph. */
  | { p: string }
  /** Where this lives in the app, e.g. "Commerce → Channel profit". */
  | { where: string }
  /** Numbered steps. */
  | { steps: readonly { title: string; body: string }[] }
  /** A bulleted list. */
  | { list: readonly string[] }
  /** "What you should see": checks a reader can tick off to know it worked. */
  | { check: readonly string[] }
  /** A tip or a caution. */
  | { note: string; tone?: "tip" | "caution" }
  /** A small table. */
  | { table: { head: readonly string[]; rows: readonly (readonly string[])[] } };

export type CategoryId =
  | "start"
  | "marketplaces"
  | "payouts"
  | "banking"
  | "invoices"
  | "reviews"
  | "accounting"
  | "inventory"
  | "reports"
  | "advertising"
  | "company"
  | "playbooks";

export type Guide = {
  slug: string;
  category: CategoryId;
  title: string;
  /** One or two sentences: the index card and the page's lead. */
  summary: string;
  sections: readonly { heading: string; blocks: readonly Block[] }[];
  /** Guides to read next. */
  related?: readonly string[];
};
