import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import pg from "pg";

const MAIL_LOG = ".dev-mail.log";

/** Latest link in the dev mail log sent to `email` whose URL contains `fragment`. */
export async function latestLink(email: string, fragment: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const log = await readFile(MAIL_LOG, "utf8").catch(() => "");
    const entries = log.split("--- ").filter((e) => e.includes(`To: ${email}`));
    const urls = entries
      .flatMap((e) => e.match(/https?:\/\/\S+/g) ?? [])
      .filter((u) => u.includes(fragment));
    const url = urls.at(-1);
    if (url) return url;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${email} containing ${fragment}`);
}

export async function signUp(page: Page, name: string, email: string, password: string) {
  await page.goto("/sign-up");
  await page.locator("#name").fill(name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function verifyEmail(page: Page, email: string) {
  await page.goto(await latestLink(email, "verify-email"));
}

/**
 * Signs in. Sign-in is rate limited (a few attempts per 10 seconds), and the suite signs in
 * often, so when the app says "Too many attempts" this waits for the window to pass and retries.
 */
export async function signIn(page: Page, email: string, password: string) {
  const tooMany = page.getByText("Too many attempts");
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/sign-in");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const limited = await tooMany
      .waitFor({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (!limited) return;
    await page.waitForTimeout(11_000);
  }
}

export async function signOut(page: Page) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign in" }).or(page.getByText("Sign in").first()),
  ).toBeVisible();
}

/** Direct DB access (owner role) for test setup that has no UI, e.g. simulating a Google-only user. */
export async function withOwnerDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString:
      process.env.DATABASE_URL_MIGRATOR ??
      "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze",
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Opens a transaction from the list through its row menu. On wide screens clicking a value on
 * the row changes that value instead of opening the transaction.
 */
export async function openTransaction(page: Page, text: string) {
  await page
    .locator("li", { hasText: text })
    .getByRole("button", { name: /^More for / })
    .click();
  await page.getByRole("menuitem", { name: /^(Edit|View) details$/ }).click();
}

/**
 * Picks an option in a searchable dropdown (`Combobox`): opens it, types to filter when it has a
 * search box, and clicks the option with this exact label.
 */
export async function choose(trigger: Locator, option: string | RegExp) {
  await trigger.click();
  const page = trigger.page();
  const search = page.locator('input[role="combobox"][aria-autocomplete="list"]');
  await expect(page.getByRole("listbox")).toBeVisible();
  if (typeof option === "string" && (await search.count()) > 0) {
    await search.fill(option.replace(/ \(.*\)$/, ""));
  }
  await page
    .getByRole("listbox")
    .getByRole("option", { name: option, exact: typeof option === "string" })
    .click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
