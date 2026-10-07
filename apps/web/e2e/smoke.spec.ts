import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  choose,
  latestLink,
  openTransaction,
  signIn,
  signOut,
  signUp,
  verifyEmail,
  withOwnerDb,
} from "./helpers";
import { statementPdf } from "./statement-pdf";

// Unique emails per run so the suite can run against a reused database.
const run = Date.now().toString(36);
const owner = {
  name: "Olivia Owner",
  email: "owner@example.com",
  password: "correct-horse-battery",
};
const teammate = {
  name: "Tariq Teammate",
  email: `teammate+${run}@example.com`,
  password: "another-strong-pass",
};
const googleOnly = {
  name: "Gina Google",
  email: `gina+${run}@example.com`,
  password: "temporary-password",
};

test.describe.configure({ mode: "serial" });

test("owner signs up, verifies email and sets up a company with the wizard", async ({ page }) => {
  // The platform admin email may sign up even though sign-ups are invite-only.
  await withOwnerDb((db) => db.query(`delete from "user" where email = $1`, [owner.email]));
  await signUp(page, owner.name, owner.email, owner.password);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await verifyEmail(page, owner.email);

  await expect(page).toHaveURL(/\/onboarding/);
  // Step 1: company. Continuing without a name shows a friendly error.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Give your company a name.")).toBeVisible();
  await page.locator("#name").fill(`Maple Goods ${run}`);
  await expect(page.locator("#legalName")).toHaveValue(`Maple Goods ${run}`);
  await page.locator("#legalName").fill("Maple Goods Inc.");
  await page.locator("#incorporationDate").fill("2026-06-23");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: location, with currency suggested from the country.
  await expect(page.getByRole("heading", { name: "Where you operate" })).toBeVisible();
  await choose(page.locator("#countryCode"), "United Arab Emirates");
  await expect(page.locator("#baseCurrency")).toContainText("AED");
  // Choosing with the keyboard: Enter picks the option and stays on this step.
  await page.locator("#countryCode").click();
  await page.keyboard.type("Canada");
  await page.keyboard.press("Enter");
  await expect(page.locator("#countryCode")).toContainText("Canada");
  await expect(page.getByRole("heading", { name: "Where you operate" })).toBeVisible();
  await expect(page.locator("#baseCurrency")).toContainText("CAD");
  await choose(page.locator("#subdivisionCode"), "Ontario");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: financial year with a live preview of the short first year.
  await expect(page.getByRole("heading", { name: "Financial year" })).toBeVisible();
  await expect(
    page.getByText("Your current financial year is FY2026 (a short first year)"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: review and create.
  await expect(page.getByText("Ontario, Canada")).toBeVisible();
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/\/o\/maple-goods-/);
  await expect(page.getByText("Get started with Bookalyze")).toBeVisible();
  await expect(page.getByText("Ontario, Canada")).toBeVisible();
  await expect(page.getByText("CAD", { exact: true })).toBeVisible();
});

test("features respect dependencies and drive navigation", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await expect(page).toHaveURL(/\/o\//);
  await page.getByRole("link", { name: "Features", exact: true }).click();

  // Accounting can't be switched off while Banking depends on it.
  await page.locator("#module-accounting").click();
  await expect(page.getByText(/Turn off Banking first/)).toBeVisible();
  await expect(page.locator("#module-accounting")).toBeChecked();

  // Review requests need Commerce first.
  await page.locator("#module-reviews").click();
  await expect(page.getByText(/Review requests requires Commerce/)).toBeVisible();

  await page.locator("#module-commerce").click();
  await expect(page.getByText("Commerce switched on")).toBeVisible();
  await expect(page.getByRole("link", { name: "Commerce", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Commerce", exact: true }).click();
  await expect(page.getByText("Connect a marketplace first")).toBeVisible();
  await page.getByRole("link", { name: "Channels", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect Amazon Seller Central" })).toBeVisible();

  await page.getByRole("link", { name: "Features", exact: true }).click();
  await page.locator("#module-commerce").click();
  await expect(page.getByText("Commerce switched off")).toBeVisible();
  await expect(page.getByRole("link", { name: "Commerce", exact: true })).toHaveCount(0);
});

test("financial year follows settings, including a short first year", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await expect(page.getByText("FY2026", { exact: true })).toBeVisible();
  await expect(page.getByText("Short first year")).toBeVisible();

  await page.getByRole("link", { name: "Company settings", exact: true }).click();
  await page.getByText("July to June").click();
  await expect(page.getByText("You have unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Company settings saved")).toBeVisible();

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByText("FY2026-27")).toBeVisible();
});

test("bookkeeping: chart of accounts, journal entries, reversal and reports", async ({ page }) => {
  await signIn(page, owner.email, owner.password);

  // New companies start with the standard chart of accounts.
  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await expect(page.getByText("Cash on hand")).toBeVisible();
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Name").fill("RBC Chequing");
  await page.getByLabel("Code (optional)").fill("1010");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Account added")).toBeVisible();
  await expect(page.getByText("RBC Chequing")).toBeVisible();

  // Codes are unique per company.
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Name").fill("Duplicate");
  await page.getByLabel("Code (optional)").fill("1010");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Another account already uses this code.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // A balanced entry: the owner puts money in.
  const postEntry = async (memo: string, debit: string, credit: string, amount: string) => {
    await page.getByRole("link", { name: "Journal entries", exact: true }).click();
    await page
      .getByRole("link", { name: /New (journal )?entry/ })
      .first()
      .click();
    await page.getByLabel("Description", { exact: true }).fill(memo);
    await choose(page.getByLabel("Account for line 1"), debit);
    await page.getByLabel("Debit").nth(0).fill(amount);
    await choose(page.getByLabel("Account for line 2"), credit);
    await page.getByLabel("Credit").nth(1).fill("1");
    await expect(page.getByText(/Out by/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Post entry" })).toBeDisabled();
    await page.getByLabel("Credit").nth(1).fill(amount);
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Post entry" }).click();
    await expect(page).toHaveURL(/\/accounting\/journal\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: memo })).toBeVisible();
  };
  await postEntry("Owner investment", "1010 · RBC Chequing", "3000 · Owner contributions", "5000");
  await expect(page.getByText("JE-0001", { exact: true })).toBeVisible();
  await postEntry("October rent", "6350 · Rent", "1010 · RBC Chequing", "1,200.00");

  // Reports reflect both entries.
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("link", { name: /Trial balance/ }).click();
  await expect(page.getByText("Debits equal credits.")).toBeVisible();
  await expect(page.getByText("$3,800.00")).toBeVisible();
  // Every report downloads as CSV, with the company, report and period on top.
  const downloadCsv = async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    return readFile(await download.path(), "utf8");
  };
  const tbCsv = await downloadCsv();
  expect(tbCsv).toContain("Report,Trial balance");
  expect(tbCsv).toContain(",,Total,5000.00,5000.00");
  await page.getByRole("link", { name: "All reports" }).click();
  await page.getByRole("link", { name: /Profit and loss/ }).click();
  await expect(page.getByText("Net loss")).toBeVisible();
  await page.getByRole("link", { name: "All reports" }).click();
  await page.getByRole("link", { name: /Balance sheet/ }).click();
  await expect(page.getByText("Assets equal liabilities plus equity.")).toBeVisible();
  await expect(page.getByText("Profit for this financial year")).toBeVisible();

  // Any account on a report opens its lines in the general ledger, with a running balance.
  await page.getByRole("link", { name: /RBC Chequing/ }).click();
  await expect(page).toHaveURL(/\/reports\/general-ledger\?.*account=/);
  await expect(page.getByRole("heading", { name: /RBC Chequing/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Owner investment/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /October rent/ })).toBeVisible();
  await expect(page.getByText("Closing balance")).toBeVisible();
  await expect(page.getByText("$3,800.00").last()).toBeVisible();
  const ledgerCsv = await downloadCsv();
  expect(ledgerCsv).toContain("Account,1010 RBC Chequing");
  expect(ledgerCsv).toContain(",Owner investment,,5000.00,,5000.00,,");
  expect(ledgerCsv).toContain(",,,Closing balance,,,,3800.00,,");
  // "All accounts" shows each account's opening, debits, credits and closing.
  await choose(page.getByLabel("Account", { exact: true }), "All accounts");
  await expect(page.getByRole("link", { name: /Rent/ }).first()).toBeVisible();
  await expect(page.getByText("Total posted in the period")).toBeVisible();
  await page.getByRole("link", { name: /Owner contributions/ }).click();
  await expect(page.getByRole("heading", { name: /Owner contributions/ })).toBeVisible();

  // Posted entries are reversed, not edited.
  await page.getByRole("link", { name: "Journal entries", exact: true }).click();
  await page.getByRole("link", { name: /October rent/ }).click();
  await page.getByRole("button", { name: "Reverse" }).click();
  await page.getByRole("button", { name: "Reverse entry" }).click();
  await expect(page.getByText(/JE-0002 reversed by JE-0003/)).toBeVisible();
  await expect(page.getByText("This entry reverses")).toBeVisible();
  await page.getByRole("link", { name: "JE-0002" }).click();
  await expect(page.getByText(/This entry was reversed by/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reverse" })).toHaveCount(0);

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("link", { name: /Profit and loss/ }).click();
  await expect(page.getByText("Net profit")).toBeVisible();
  // Compared with the previous period: each account shows what it was and the change.
  await choose(page.locator("#compare"), "Previous period");
  await expect(page).toHaveURL(/compare=previous/);
  await expect(page.getByText(/compared with/)).toBeVisible();
  // The rent entry was reversed, so neither period has income or expenses left.
  await expect(page.getByText("Nothing in either period.").first()).toBeVisible();
  const compareCsv = await downloadCsv();
  expect(compareCsv).toContain("Compared with,");
  expect(compareCsv).toMatch(/Section,Code,Account,[^,]+,[^,]+,Change/);

  // Once there are entries the main currency is locked, and finished periods can be closed.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(),
  );
  await page.getByRole("link", { name: "Company settings", exact: true }).click();
  await expect(page.locator("#baseCurrency")).toBeDisabled();
  await page.locator("#booksLockedThrough").fill(today);
  await page.getByRole("button", { name: "Close books through this date" }).click();
  await expect(page.getByText(/^Books closed through/)).toBeVisible();

  await page.getByRole("link", { name: "Journal entries", exact: true }).click();
  await page.getByRole("link", { name: /Owner investment/ }).click();
  await expect(page.getByText("Closed period", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "New entry" }).click();
  await expect(page.locator("#date")).not.toHaveValue(today);
  await page.locator("#date").fill(today);
  await expect(page.getByText(/Books are closed through .*Choose a later date/)).toBeVisible();

  await page.getByRole("link", { name: "Company settings", exact: true }).click();
  await page.getByRole("button", { name: "Reopen all periods" }).click();
  await page.getByRole("button", { name: "Click again to reopen" }).click();
  await expect(page.getByText("All periods reopened")).toBeVisible();
  await expect(page.getByText("All periods are open.")).toBeVisible();
});

test("transactions: money in, split expense, review, edit and remove", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByText("Owner investment")).toBeVisible();
  // Reversed entries and their reversals are hidden.
  await expect(page.getByText("October rent")).toHaveCount(0);

  // Money in.
  await page.getByRole("button", { name: "Add income" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Client payment");
  await choose(page.getByLabel("Category 1", { exact: true }), "4000 · Sales");
  await page.getByLabel("Amount 1").fill("800");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();
  const payment = page.locator("li", { hasText: "Client payment" });
  await expect(payment.getByText("+$800.00")).toBeVisible();

  // Money out, split across two categories.
  await page.getByRole("button", { name: "Add expense" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Supplies and shipping");
  await choose(page.getByLabel("Category 1", { exact: true }), "6250 · Office supplies");
  await page.getByLabel("Amount 1").fill("40");
  await page.getByRole("button", { name: "Split into categories" }).click();
  await choose(page.getByLabel("Category 2", { exact: true }), "6400 · Shipping and postage");
  await page.getByLabel("Amount 2").fill("25.50");
  await expect(page.getByText("$65.50")).toBeVisible();
  await page.getByRole("button", { name: "Add transaction" }).click();
  const supplies = page.locator("li", { hasText: "Supplies and shipping" });
  await expect(supplies.getByText("Split (2)")).toBeVisible();
  await expect(supplies.getByText("−$65.50")).toBeVisible();

  // Review, and filter by status.
  await payment.getByRole("button", { name: /as reviewed/ }).click();
  await expect(payment.getByRole("button", { name: /as not reviewed/ })).toBeVisible();
  await choose(page.getByLabel("Status"), "Needs review");
  await expect(page.getByText("Supplies and shipping")).toBeVisible();
  await expect(page.getByText("Client payment")).toHaveCount(0);
  await choose(page.getByLabel("Status"), "Reviewed");
  await expect(page.getByText("Client payment")).toBeVisible();

  // Edit keeps the review tick and replaces the amount.
  await openTransaction(page, "Client payment");
  await expect(page.getByRole("heading", { name: "Edit transaction" })).toBeVisible();
  await page.getByLabel("Amount 1").fill("850");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Transaction updated")).toBeVisible();
  await expect(
    page.locator("li", { hasText: "Client payment" }).getByText("+$850.00"),
  ).toBeVisible();

  // Remove.
  await choose(page.getByLabel("Status"), "Reviewed or not");
  await openTransaction(page, "Supplies and shipping");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Click again to remove" }).click();
  await expect(page.getByText("Transaction removed")).toBeVisible();
  await expect(page.getByText("Supplies and shipping")).toHaveCount(0);

  // Remove several at once, and select everything on the page.
  for (const memo of ["Duplicate order A", "Duplicate order B"]) {
    await page.getByRole("button", { name: "Add expense" }).click();
    await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
    await page.locator("#tx-memo").fill(memo);
    await choose(page.getByLabel("Category 1", { exact: true }), "6250 · Office supplies");
    await page.getByLabel("Amount 1").fill("12");
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(page.locator("li", { hasText: memo })).toBeVisible();
  }
  await page
    .getByRole("checkbox", { name: "Select all on this page" })
    .first()
    .check({ force: true });
  await expect(page.getByText(/^\d+ selected$/)).toBeVisible();
  await page.getByRole("checkbox", { name: "Clear selection" }).first().uncheck({ force: true });
  await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0);
  await page
    .locator("li", { hasText: "Duplicate order A" })
    .getByRole("checkbox")
    .check({ force: true });
  await page
    .locator("li", { hasText: "Duplicate order B" })
    .getByRole("checkbox")
    .check({ force: true });
  await page.getByRole("button", { name: "Remove 2 selected" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove 2" }).click();
  await expect(page.getByText("2 transactions removed")).toBeVisible();
  await expect(page.getByText("Duplicate order A")).toHaveCount(0);
  await expect(page.getByText("Duplicate order B")).toHaveCount(0);

  // Fewer per page.
  await choose(page.getByLabel("Transactions per page"), "25");
  await expect(page).toHaveURL(/per=25/);

  // One account at a time, with its balance: 5,000 + 850.
  await choose(page.getByLabel("Account", { exact: true }), "1010 · RBC Chequing");
  await expect(page.getByText("RBC Chequing balance")).toBeVisible();
  await expect(page.getByText("$5,850.00")).toBeVisible();
});

test("transactions: add a category on the spot, change values on the list, remove from the menu", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();

  // A category that doesn't exist yet, added from the dropdown without leaving the form.
  await page.getByRole("button", { name: "Add expense" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Courier");
  await page.getByLabel("Category 1", { exact: true }).click();
  await page.locator('input[role="combobox"][aria-autocomplete="list"]').fill("Courier fees");
  await page.getByRole("button", { name: "Add “Courier fees” as a new category" }).click();
  const form = page.getByRole("dialog", { name: "Add a category" });
  await expect(form.getByLabel("Name")).toHaveValue("Courier fees");
  await form.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Courier fees added")).toBeVisible();
  await expect(page.getByLabel("Category 1", { exact: true })).toHaveText("Courier fees");
  await page.getByLabel("Amount 1").fill("18");
  await page.getByRole("button", { name: "Add transaction" }).click();
  // The transaction's row (not the toast or the dialog's category line, which also say it).
  const courier = page.locator("li", {
    hasText: "Courier",
    has: page.getByRole("checkbox", { name: /^Select JE-/ }),
  });
  await expect(courier).toContainText("−$18.00");
  const saved = () => expect(page.locator("li[aria-busy]")).toHaveCount(0);

  // Description, amount and date change in place; Enter saves.
  await courier.getByRole("button", { name: "Courier", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Courier to Ottawa");
  await page.keyboard.press("Enter");
  await saved();
  await expect(courier).toContainText("Courier to Ottawa");

  await courier.getByRole("button", { name: "−$18.00" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("21.50");
  await page.keyboard.press("Enter");
  await saved();
  await expect(courier).toContainText("−$21.50");

  // Escape keeps the old value.
  await courier.getByRole("button", { name: "−$21.50" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("99");
  await page.keyboard.press("Escape");
  await expect(courier).toContainText("−$21.50");

  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(Date.now() - 86_400_000),
  );
  await courier.getByTitle("Click to change the date").click();
  await page.getByLabel("Date", { exact: true }).fill(yesterday);
  await page.keyboard.press("Enter");
  await saved();

  // Category and account are dropdowns on the row.
  await choose(courier.getByRole("combobox", { name: "Category" }), "6400 · Shipping and postage");
  await saved();
  await expect(courier).toContainText("Shipping and postage");

  // Everything stuck: the details show the new values.
  await openTransaction(page, "Courier to Ottawa");
  await expect(page.locator("#tx-date")).toHaveValue(yesterday);
  await expect(page.getByLabel("Amount 1")).toHaveValue("21.50");
  await expect(page.getByLabel("Category 1", { exact: true })).toHaveText(
    "6400 · Shipping and postage",
  );
  await page.getByRole("button", { name: "Cancel" }).click();

  // Filter by category (the filter comes before the rows' own category dropdowns).
  await choose(
    page.getByRole("combobox", { name: "Category", exact: true }).first(),
    "6400 · Shipping and postage",
  );
  await expect(page).toHaveURL(/category=/);
  await expect(courier).toBeVisible();
  await expect(page.locator("li", { hasText: "Client payment" })).toHaveCount(0);

  // The row menu removes it after a confirmation.
  await courier.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove transaction" }).click();
  await expect(page.getByText("Transaction removed")).toBeVisible();
  await expect(courier).toHaveCount(0);
});

test("receipts: inbox, attach to a transaction, and attach while adding one", async ({ page }) => {
  // A 1×1 PNG and a tiny PDF, both synthetic.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  await signIn(page, owner.email, owner.password);

  // Upload to the inbox first, then attach it to its transaction.
  await page.getByRole("link", { name: "Receipts", exact: true }).click();
  await expect(page.getByText("Your inbox is empty")).toBeVisible();
  await page.getByLabel("Upload receipts").setInputFiles({
    name: "march-receipt.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(page.getByText("march-receipt.pdf added to your inbox")).toBeVisible();
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await page.getByLabel("Search transactions").fill("Client");
  await page.getByRole("button", { name: /Client payment/ }).click();
  await expect(page.getByText("Attached to Client payment")).toBeVisible();
  await expect(page.getByText("Your inbox is empty")).toBeVisible();

  // The transaction shows it, and its dialog can add and remove more.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  const payment = page.locator("li", { hasText: "Client payment" });
  await expect(payment.getByText("1 file attached")).toBeAttached();
  await openTransaction(page, "Client payment");
  await expect(page.getByRole("link", { name: /march-receipt\.pdf/ })).toBeVisible();
  const href = await page.getByRole("link", { name: /march-receipt\.pdf/ }).getAttribute("href");
  const file = await page.request.get(href ?? "");
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("application/pdf");

  await page
    .getByLabel("Upload receipts")
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Receipt attached")).toBeVisible();
  await expect(page.getByRole("img", { name: "photo.png" })).toBeVisible();
  await page.getByRole("button", { name: "Remove photo.png" }).click();
  await expect(page.getByText("Removed. The file is back in your receipts inbox.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // Attach while adding a new transaction: saved together.
  await page.getByRole("button", { name: "Add expense" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Printer paper");
  await choose(page.getByLabel("Category 1", { exact: true }), "6250 · Office supplies");
  await page.getByLabel("Amount 1").fill("12.99");
  await page
    .getByLabel("Upload receipts")
    .setInputFiles({ name: "paper.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "paper.png" })).toBeVisible();
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(
    page.locator("li", { hasText: "Printer paper" }).getByText("1 file attached"),
  ).toBeAttached();

  // The removed photo waits in the inbox, and can be deleted there.
  await page.getByRole("link", { name: "Receipts", exact: true }).click();
  await expect(page.getByText("photo.png")).toBeVisible();
  await page.getByRole("button", { name: "Delete photo.png" }).click();
  await page.getByRole("button", { name: "Confirm delete photo.png" }).click();
  await expect(page.getByText("Receipt deleted")).toBeVisible();
  await expect(page.getByText("Your inbox is empty")).toBeVisible();

  // Several at once: tick "Select all" and delete them together.
  await page.getByLabel("Upload receipts").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: png },
    { name: "two.png", mimeType: "image/png", buffer: png },
  ]);
  // Both uploads finished (their names also show while uploading).
  await expect(page.getByText("one.png added to your inbox")).toBeVisible();
  await expect(page.getByText("two.png added to your inbox")).toBeVisible();
  await expect(page.getByText("Select all (2)")).toBeVisible();
  await page.getByLabel("Select all receipts").check({ force: true });
  await expect(page.getByText("2 of 2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Delete 2" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete 2" }).click();
  await expect(page.getByText("2 receipts deleted")).toBeVisible();
  await expect(page.getByText("Your inbox is empty")).toBeVisible();
});

test("customers and vendors: add, pick on transactions, totals and filter", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Customers & vendors", exact: true }).click();
  await expect(page.getByText("No customers or vendors yet")).toBeVisible();
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.locator("#contact-name").fill("Northwind Traders");
  await page.locator("#contact-email").fill("billing@northwind.example");
  await page.getByRole("button", { name: "Add contact" }).last().click();
  await expect(page.getByRole("heading", { name: "Northwind Traders" })).toBeVisible();

  // Money in from the customer.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Add income" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Consulting invoice 101");
  await choose(page.locator("#tx-contact"), "Northwind Traders");
  await choose(page.getByLabel("Category 1", { exact: true }), "4000 · Sales");
  await page.getByLabel("Amount 1").fill("1500");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.locator("li", { hasText: "Consulting invoice 101" })).toContainText(
    "Consulting invoice 101 · Northwind Traders",
  );

  // Money out to a vendor created on the spot.
  await page.getByRole("button", { name: "Add expense" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Toner");
  await page.locator("#tx-contact").click();
  await page.getByRole("button", { name: "Add a new vendor" }).click();
  await page.locator("#tx-new-contact").fill("Office Depot");
  await page.locator("#tx-new-contact").press("Enter");
  await expect(page.getByText("Office Depot added")).toBeVisible();
  await expect(page.locator("#tx-contact")).toHaveText("Office Depot");
  await choose(page.getByLabel("Category 1", { exact: true }), "6250 · Office supplies");
  await page.getByLabel("Amount 1").fill("30");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.locator("li", { hasText: "Toner" })).toContainText("Toner · Office Depot");

  // Totals on the contact page, and its transactions in the list.
  await page.getByRole("link", { name: "Customers & vendors", exact: true }).click();
  await page.getByRole("link", { name: /Northwind Traders/ }).click();
  await expect(page.getByText("$1,500.00").first()).toBeVisible();
  await page.getByRole("link", { name: "Open in Transactions" }).click();
  await expect(page.getByText("Showing transactions with")).toBeVisible();
  await expect(page.getByText("Consulting invoice 101")).toBeVisible();
  await expect(page.getByText("Toner")).toHaveCount(0);
  await page.getByRole("button", { name: "Stop filtering by Northwind Traders" }).click();
  await expect(page.getByText("Toner")).toBeVisible();

  await page.getByRole("link", { name: "Customers & vendors", exact: true }).click();
  await page.getByRole("link", { name: "Vendors", exact: true }).click();
  await expect(page.getByText("Office Depot", { exact: true })).toBeVisible();
  await expect(page.getByText("Northwind Traders")).toHaveCount(0);
});

test("exchange rates: suggested rate, USD income and a USD → CAD transfer", async ({ page }) => {
  // Store today's Bank of Canada rate, as the daily job would (no network needed).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(),
  );
  await withOwnerDb((db) =>
    db.query(
      `insert into fx_rates (date, base, quote, rate, source) values ($1, 'CAD', 'USD', 1.3650, 'Bank of Canada')
       on conflict (date, base, quote) do update set rate = excluded.rate`,
      [today],
    ),
  );
  await signIn(page, owner.email, owner.password);

  // A USD bank account.
  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Name").fill("Wise USD");
  await page.getByLabel("Code (optional)").fill("1020");
  await choose(page.locator("#currency"), /^USD · /);
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Account added")).toBeVisible();

  // Money in to the USD account: the rate is suggested.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Add income" }).click();
  await choose(page.locator("#tx-money"), "1020 · Wise USD (USD)");
  await expect(page.locator("#tx-rate")).toHaveValue("1.365");
  await expect(page.getByText(/Bank of Canada rate for/)).toBeVisible();
  await page.locator("#tx-memo").fill("US client payment");
  await choose(page.getByLabel("Category 1", { exact: true }), "4000 · Sales");
  await page.getByLabel("Amount 1").fill("1000");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(
    page.locator("li", { hasText: "US client payment" }).getByText("+US$1,000.00"),
  ).toBeVisible();

  // Move USD into the CAD account: what left and what arrived.
  await page.getByRole("button", { name: "Transfer" }).click();
  await choose(page.locator("#tx-from"), "1020 · Wise USD (USD)");
  await choose(page.locator("#tx-to"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Convert to CAD");
  await page.locator("#tx-amount").fill("500");
  await page.locator("#tx-received").fill("680");
  await expect(page.getByText("Your bank's rate: 1 USD = 1.36 CAD.")).toBeVisible();
  await expect(page.locator("#tx-rate")).toHaveCount(0);
  await page.getByRole("button", { name: "Add transaction" }).click();
  const conversion = page.locator("li", { hasText: "Convert to CAD" });
  await expect(conversion).toContainText("US$500.00");
  await expect(conversion.getByText("→ $680.00")).toBeVisible();

  await choose(page.getByLabel("Account", { exact: true }), "1010 · RBC Chequing");
  await expect(
    page.locator("li", { hasText: "Convert to CAD" }).getByText("+$680.00"),
  ).toBeVisible();

  // The chart of accounts shows the USD account's balance in USD (1,000 in, 500 out).
  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await expect(page.locator("li", { hasText: "Wise USD" })).toContainText("US$500.00");
});

test("sales tax: Ontario setup, HST on transactions and the filing report", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Sales tax", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set up Canada: GST/HST" })).toBeVisible();
  await page.getByRole("button", { name: "Add 3 rates" }).click();
  await expect(page.getByText("3 rates added")).toBeVisible();
  await expect(page.getByText("HST 13% (Ontario)")).toBeVisible();

  // The registration started by the setup: add the (synthetic) number and file monthly.
  await page.getByRole("button", { name: /Canada Revenue Agency \(GST\/HST\)/ }).click();
  await page.locator("#reg-number").fill("123456789 RT0001");
  await choose(page.locator("#reg-frequency"), "Monthly");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Registration saved")).toBeVisible();
  await expect(page.getByText(/123456789 RT0001 · Files monthly/)).toBeVisible();

  // A $113 sale with HST included, and a $56.50 purchase with HST to claim back.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Add income" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Website sale");
  await choose(page.getByLabel("Category 1", { exact: true }), "4000 · Sales");
  await choose(page.getByLabel("Sales tax 1"), "HST 13% (Ontario)");
  await page.getByLabel("Amount 1").fill("113");
  await expect(page.getByText("Includes $13.00 HST 13% (Ontario) you collected.")).toBeVisible();
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();

  await page.getByRole("button", { name: "Add expense" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Printer ink");
  await choose(page.getByLabel("Category 1", { exact: true }), "6250 · Office supplies");
  await choose(page.getByLabel("Sales tax 1"), "HST 13% (Ontario)");
  await page.getByLabel("Amount 1").fill("56.50");
  await expect(
    page.getByText("Includes $6.50 HST 13% (Ontario) you can claim back."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add transaction" }).click();
  const ink = page.locator("li", { hasText: "Printer ink" });
  await expect(ink).toContainText("−$56.50");

  // Reopening shows the amount with tax included and the rate picked.
  await openTransaction(page, "Website sale");
  await expect(page.getByLabel("Amount 1")).toHaveValue("113");
  await expect(page.getByLabel("Sales tax 1")).toHaveText("HST 13% (Ontario)");
  await page.getByRole("button", { name: "Cancel" }).click();

  // The report for today: $13 collected, $6.50 to claim back, $6.50 owing.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(),
  );
  const slug = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/o/${slug}/accounting/reports/sales-tax?from=${today}&to=${today}`);
  await expect(page.getByText("Tax you collected").locator("..")).toContainText("$13.00");
  await expect(page.getByText("Tax you can claim back").locator("..")).toContainText("$6.50");
  await expect(page.getByText("You owe").locator("..")).toContainText("$6.50");
  await expect(page.locator("li", { hasText: "HST 13% (Ontario)" })).toContainText("$100.00");

  // The accountant's export: Wave's columns, one row per line, sales tax split out.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("link", { name: "Export for accountant" }).click();
  await expect(page.getByRole("heading", { name: "Accounting transactions" })).toBeVisible();
  await expect(page.getByText("The first lines of the file")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/accounting-transactions.*\.csv$/);
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain(
    "Transaction ID,Transaction Date,Account Name,Transaction Description,Transaction Line Description,Amount (One column),Debit Amount (Two Column Approach),Credit Amount (Two Column Approach),Other Accounts for this Transaction",
  );
  const saleLine = csv.split("\r\n").find((l) => l.includes(",Sales,Website sale,"));
  expect(saleLine).toMatch(/,-100\.00,,100\.00,/);
  expect(saleLine).toMatch(/,100\.00,13\.00,[^,]*HST[^,]*,/);
});

test("searchable dropdowns: type to filter and pick with the keyboard", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Add expense" }).click();
  const category = page.getByLabel("Category 1", { exact: true });
  await category.focus();
  // Typing on the closed dropdown opens it and starts the search.
  await page.keyboard.press("o");
  const search = page.getByPlaceholder("Search categories or codes");
  await expect(search).toHaveValue("o");
  await search.pressSequentially("ffice");
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveAccessibleName("6250 · Office supplies");
  await page.keyboard.press("Enter");
  await expect(category).toHaveText("6250 · Office supplies");
  // Codes match too, and an empty search says so.
  await category.click();
  await search.fill("6400");
  await expect(options).toHaveCount(1);
  await search.fill("zzzz");
  await expect(page.getByText("No category matches.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add a transaction" })).toBeVisible();
});

test("import: a Wave export with contacts and receipts, a safe re-run and undo", async ({
  page,
}) => {
  // Synthetic data in Wave's export layout: a sale with HST and a card purchase.
  const csv = [
    "Transaction ID,Transaction Date,Account Name,Transaction Description,Transaction Line Description,Amount (One column),Debit Amount (Two Column Approach),Credit Amount (Two Column Approach),Customer,Vendor,Account Group,Account Type",
    "W-1,2026-08-03,Old Chequing,Website order 1001,,226.00,226.00,,Lakeside Studio,,Assets,Cash and Bank",
    "W-1,2026-08-03,Sales,Website order 1001,,-200.00,,200.00,Lakeside Studio,,Income,Income",
    "W-1,2026-08-03,GST/HST Payable,Website order 1001,HST,-26.00,,26.00,Lakeside Studio,,Liabilities & Credit Cards,Sales Taxes",
    "W-2,2026-08-04,Office Supplies,Paper and toner,,84.75,84.75,,,Paper Co,Expenses,Operating Expense",
    "W-2,2026-08-04,Old Visa,Paper and toner,,-84.75,,84.75,,Paper Co,Liabilities & Credit Cards,Credit Card",
  ].join("\n");
  const file = { name: "wave-transactions.csv", mimeType: "text/csv", buffer: Buffer.from(csv) };

  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(page.getByText("Bring your books with you")).toBeVisible();
  await page.getByRole("link", { name: "Start an import" }).click();
  await expect(page.getByText("How to export from Wave")).toBeVisible();
  await page.getByLabel("CSV file to import").setInputFiles(file);

  // Columns were recognised from Wave's names.
  await expect(page.getByText("Match the columns")).toBeVisible();
  await expect(page.locator("#col-entryRef")).toHaveText("Transaction ID");
  await expect(page.locator("#col-debit")).toHaveText("Debit Amount (Two Column Approach)");
  await expect(page.getByText(/2 transactions from/)).toBeVisible();
  await page.getByRole("button", { name: "Next: accounts" }).click();

  // Existing accounts are matched by name; the rest are created by type.
  await expect(
    page.getByText(/5 accounts in the file: 3 match accounts you have, 2 will be added/),
  ).toBeVisible();
  await expect(page.getByLabel("Where Old Visa goes")).toHaveText("New account: Credit card");
  await expect(page.getByLabel("Where Sales goes")).toHaveText("4000 · Sales");
  // Each account can show its transactions from the file, to help decide where it goes.
  const visa = page.locator("li", { hasText: "Old Visa" }).first();
  await visa.getByRole("button", { name: "Show transactions" }).click();
  await expect(visa.getByText("Paper and toner")).toBeVisible();
  await expect(visa.getByText("To Office Supplies")).toBeVisible();
  await page.getByRole("button", { name: "Next: review" }).click();

  await expect(page.getByText("Ready to import")).toBeVisible();
  // A customer list in Wave's layout adds their details (synthetic).
  await page.getByLabel("Customer or vendor lists").setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "customer_name,email,phone,account_number,city,province/state,country\nLakeside Studio,hi@lakeside.example,416-555-0100,XX99,Toronto,Ontario,Canada\n",
    ),
  });
  await expect(page.getByText("customers.csv")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByRole("heading", { name: "2 transactions imported" })).toBeVisible();

  // The customer came in with the details from the list.
  await page.getByRole("link", { name: "Customers & vendors", exact: true }).click();
  await page.getByRole("link", { name: /Lakeside Studio/ }).click();
  await expect(page.getByText("hi@lakeside.example")).toBeVisible();

  // Receipt files named by date and merchant: one matches a transaction, one goes to the inbox.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await page.getByLabel("Receipt files to import").setInputFiles([
    { name: "2026-08-04-Paper_Co.png", mimeType: "image/png", buffer: png },
    { name: "2026-08-20-Nowhere_Cafe.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByText("2026-08-04-Paper_Co.png")).toBeVisible();
  await page.getByRole("button", { name: "Upload 2 receipts" }).click();
  await expect(page.getByText("1 attached, 1 in your inbox.")).toBeVisible();
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.locator("li", { hasText: "Paper and toner" }).getByText("1 file attached"),
  ).toBeAttached();

  // The imported sale shows on Transactions with its customer.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByText("Website order 1001")).toBeVisible();
  await expect(page.getByText(/Lakeside Studio/).first()).toBeVisible();

  // Importing the same file again changes nothing.
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await page.getByRole("link", { name: "Import from a file" }).click();
  await page.getByLabel("CSV file to import").setInputFiles(file);
  await page.getByRole("button", { name: "Next: accounts" }).click();
  await page.getByRole("button", { name: "Next: review" }).click();
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByRole("heading", { name: "0 transactions imported" })).toBeVisible();
  await expect(page.getByText("2 were already in your books")).toBeVisible();

  // Undo the first import: its transactions and new accounts go.
  await page.getByRole("link", { name: "Back to imports" }).click();
  const first = page.locator("li", { hasText: "2 transactions from" });
  await first.getByRole("button", { name: "Undo import" }).click();
  await first.getByRole("button", { name: "Click again to remove everything it added" }).click();
  await expect(page.getByText("Import undone: 2 transactions removed")).toBeVisible();
  await expect(first.getByText("Undone")).toBeVisible();
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByText("Website order 1001")).toHaveCount(0);
});

test("reconcile: tick to the statement balance, lock, undo and cancel", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Reconcile", exact: true }).click();
  await page.getByRole("link", { name: /1010 · RBC Chequing/ }).click();
  await expect(page.getByText("Start with your bank statement")).toBeVisible();
  await page.locator("#statementBalance").fill("0");
  await page.getByRole("button", { name: "Start reconciling" }).click();

  // Tick everything, then set the statement balance to what's cleared.
  // Each line shows the balance after it, as a bank statement does.
  await expect(page.getByText("Balance", { exact: true })).toBeVisible();
  await page.getByLabel("Tick all shown").check({ force: true });
  const cleared = page.locator("dt", { hasText: "Cleared" }).locator("..").locator("dd");
  await expect(cleared).not.toHaveText("$0.00");
  const balance = (await cleared.innerText()).replace(/[^0-9.\-−]/g, "").replace("−", "-");
  await page.getByRole("button", { name: "Edit statement" }).click();
  await page.locator("#edit-balance").fill(balance);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Difference $0.00")).toBeVisible();
  await page.getByRole("button", { name: "Finish reconciling" }).click();
  await expect(page.getByText("Reconciled", { exact: true })).toBeVisible();
  await expect(page.getByText(/Past reconciliations/)).toBeVisible();

  // Reconciled transactions show a lock and can't be changed.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByText(/Reconciled to the statement of/).first()).toBeAttached();
  await openTransaction(page, "Website sale");
  await expect(page.getByText(/This transaction is reconciled to your statement/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Undo reopens it; cancelling discards it.
  await page.getByRole("link", { name: "Reconcile", exact: true }).click();
  await page.getByRole("link", { name: /1010 · RBC Chequing/ }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Click again to reopen it" }).click();
  await expect(page.getByText("Reconciliation reopened")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Click again to discard" }).click();
  await expect(page.getByText("Reconciliation cancelled")).toBeVisible();
  await expect(page.getByText("Start with your bank statement")).toBeVisible();
});

test("banking: connect Wise, flag and merge duplicates, merge by hand, transfers, disconnect", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  // Already in the books by hand: the same card payment Wise is about to send.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Add expense" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Coffee with a client");
  await choose(page.getByLabel("Category 1", { exact: true }), "6250 · Office supplies");
  await page.getByLabel("Amount 1").fill("7.76");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();

  await page.getByRole("link", { name: "Banking", exact: true }).click();
  await expect(page).toHaveURL(/\/banking\/accounts$/);
  await expect(page.getByRole("heading", { name: "Connect Wise" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Wise" }).click();

  // A wrong token is refused with a plain explanation.
  await page.getByLabel("API token").fill("e2e-wrong-token-0000-1111-2222");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Wise didn't accept this API token/)).toBeVisible();

  // The right one goes straight to the only profile's balances.
  await page.getByLabel("API token").fill("e2e-wise-token-0000-1111-2222");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose what to bring in" })).toBeVisible();
  await choose(page.getByLabel("Account for the CAD balance"), "1010 · RBC Chequing");
  await choose(page.getByLabel("Account for the USD balance"), "New account “Wise USD”");
  await page.getByRole("button", { name: "Connect 2 balances" }).click();
  await expect(page.getByText("Wise connected")).toBeVisible();
  await expect(page.getByText(/2 new transactions to sort/)).toBeVisible();
  await expect(page.getByText(/1 might be a duplicate of one already in your books/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wise · Example Trading Inc." })).toBeVisible();
  await expect(page.getByText(/Synced just now/)).toBeVisible();

  // Everything came in; the card payment is flagged beside the one entered by hand.
  await page.getByRole("link", { name: /1 possible duplicate/ }).click();
  await expect(page).toHaveURL(/status=duplicates/);
  const flagged = page.locator("li", { hasText: "Card transaction at Example Cafe" });
  const flag = flagged.getByRole("button", { name: /Possible duplicate/ });
  await expect(flag).toContainText("Coffee with a client");
  await flag.click();
  const review = page.getByRole("dialog");
  await expect(review.getByText("Already in your books", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByText("Merged", { exact: true })).toBeVisible();
  await expect(page.getByText("Card transaction at Example Cafe")).toHaveCount(0);

  // Syncing again brings in nothing new.
  await page.getByRole("link", { name: "Banking", exact: true }).click();
  await expect(page.getByText(/possible duplicate/)).toHaveCount(0);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Up to date")).toBeVisible();

  // The account has the hand-entered payment once, and the conversion as one transfer.
  await page.getByRole("link", { name: /RBC Chequing/ }).click();
  await expect(page.locator("li", { hasText: "Coffee with a client" })).toContainText("−$7.76");
  await expect(page.getByText("Card transaction at Example Cafe")).toHaveCount(0);
  await expect(page.locator("li", { hasText: "Converted 136.50 CAD to 100.00 USD" })).toHaveCount(
    1,
  );

  // Merging by hand: two with the same amount, account and category.
  await page.getByRole("button", { name: "Add expense" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Coffee entered twice");
  await choose(page.getByLabel("Category 1", { exact: true }), "6250 · Office supplies");
  await page.getByLabel("Amount 1").fill("7.76");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();
  const coffee = page.locator("li", { hasText: "Coffee with a client" });
  const twice = page.locator("li", { hasText: "Coffee entered twice" });
  const transfer = page.locator("li", { hasText: "Converted 136.50 CAD" });
  await coffee.getByRole("checkbox").check({ force: true });
  await transfer.getByRole("checkbox").check({ force: true });
  await expect(
    page.getByText("They need to be the same amount, in the same direction."),
  ).toBeVisible();
  await transfer.getByRole("checkbox").uncheck({ force: true });
  await twice.getByRole("checkbox").check({ force: true });
  await expect(page.getByText(/these can be merged/)).toBeVisible();
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByText("Merged", { exact: true })).toBeVisible();
  await expect(page.getByText("Coffee entered twice")).toHaveCount(0);
  await expect(coffee).toHaveCount(1);

  // A statement file from any bank: columns matched once, flagged duplicates, nothing twice.
  await page.getByRole("button", { name: "Add expense" }).click();
  await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
  await page.locator("#tx-memo").fill("Team lunch");
  await choose(page.getByLabel("Category 1", { exact: true }), "6200 · Meals and entertainment");
  await page.getByLabel("Amount 1").fill("23.45");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();
  const transactionsUrl = page.url();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(),
  );
  const statement = {
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `Date,Description,Withdrawals,Deposits\n${today},Restaurant downtown,23.45,\n${today},Customer payment,,310.00\n`,
    ),
  };
  await page.getByRole("link", { name: "Banking", exact: true }).click();
  await page.getByRole("button", { name: "Upload a statement" }).click();
  const upload = page.getByRole("dialog");
  await choose(upload.locator("#statement-account"), "1010 · RBC Chequing");
  await upload.getByLabel("Statement file").setInputFiles(statement);
  await expect(upload.getByText("Customer payment")).toBeVisible();
  await upload.getByRole("button", { name: "Bring in 2 transactions" }).click();
  await expect(page.getByText(/2 new transactions to sort/)).toBeVisible();
  await expect(page.getByText(/1 might be a duplicate/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /RBC Chequing · Statements/ })).toBeVisible();
  // The second time, the columns are remembered and nothing is added again.
  await page.getByRole("button", { name: "Upload statement" }).click();
  await upload.getByLabel("Statement file").setInputFiles(statement);
  await expect(upload.getByText(/the way you matched this account's statements/)).toBeVisible();
  await upload.getByRole("button", { name: "Bring in 2 transactions" }).click();
  await expect(page.getByText("Already in your books", { exact: true })).toBeVisible();

  // Disconnecting deletes the token and keeps what was brought in.
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Disconnected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Wise" })).toBeVisible();
  await page.goto(transactionsUrl);
  await expect(page.getByText("Converted 136.50 CAD to 100.00 USD")).toBeVisible();
});

test("rules: categorize what's uncategorized, then new bank transactions as they arrive", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Banking", exact: true }).click();
  await page.getByRole("link", { name: "Rules", exact: true }).click();
  await expect(page.getByText("Let the regulars sort themselves")).toBeVisible();
  await page.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("When the description contains").fill("restaurant");
  await choose(dialog.locator("#rule-direction"), "Money out only");
  await choose(dialog.locator("#rule-category"), "6200 · Meals and entertainment");
  // The statement uploaded earlier has "Restaurant downtown", still uncategorized.
  await expect(dialog.getByText("1 uncategorized transaction matches it today.")).toBeVisible();
  await dialog.getByRole("button", { name: "Save and categorize 1" }).click();
  await expect(page.getByText("Rule added")).toBeVisible();
  await expect(page.getByText("Categorized 1 transaction")).toBeVisible();

  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  const restaurant = page.locator("li", { hasText: "Restaurant downtown" });
  await expect(restaurant).toContainText("Meals and entertainment");
  await expect(restaurant.getByLabel(/Categorized by your rule/)).toBeVisible();

  // New ones from the bank arrive already categorized.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(),
  );
  await page.getByRole("link", { name: "Banking", exact: true }).click();
  await page.getByRole("button", { name: "Upload statement" }).click();
  const upload = page.getByRole("dialog");
  await upload.getByLabel("Statement file").setInputFiles({
    name: "october.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `Date,Description,Withdrawals,Deposits\n${today},Restaurant uptown,41.10,\n`,
    ),
  });
  await upload.getByRole("button", { name: "Bring in 1 transaction" }).click();
  await expect(page.getByText(/1 was categorized by your rules/)).toBeVisible();

  // Any categorized transaction can become a rule.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await openTransaction(page, "Team lunch");
  await page.getByRole("link", { name: "Make a rule" }).click();
  await expect(page).toHaveURL(/banking\/rules\?text=Team/);
  await expect(page.getByLabel("When the description contains")).toHaveValue("Team lunch");
});

test("no bank account: choose it on Transactions; delete a journal entry", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  const postEntry = async (memo: string, debit: string, credit: string, amount: string) => {
    await page.getByRole("link", { name: "Journal entries", exact: true }).click();
    await page
      .getByRole("link", { name: /New (journal )?entry/ })
      .first()
      .click();
    await page.getByLabel("Description", { exact: true }).fill(memo);
    await choose(page.getByLabel("Account for line 1"), debit);
    await page.getByLabel("Debit").nth(0).fill(amount);
    await choose(page.getByLabel("Account for line 2"), credit);
    await page.getByLabel("Credit").nth(1).fill(amount);
    await page.getByRole("button", { name: "Post entry" }).click();
    await expect(page.getByRole("heading", { name: memo })).toBeVisible();
  };
  // Like a bill imported against Wave's "Unknown Account": no bank side, so it needs one.
  await postEntry("Insurance bill", "6150 · Insurance", "4990 · Uncategorized income", "75");
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByText(/(doesn't|don't) say which account paid/)).toBeVisible();
  await page.getByRole("button", { name: "Show only these" }).last().click();
  const bill = page.locator("li", { hasText: "Insurance bill" });
  await expect(bill).toContainText("Choose account");
  await bill.getByText("Insurance bill").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/never said which account the money went through/)).toBeVisible();
  await choose(dialog.locator("#tx-money"), "1010 · RBC Chequing");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Transaction updated")).toBeVisible();
  await choose(page.getByRole("combobox", { name: "Status" }), "Reviewed or not");
  await expect(page.locator("li", { hasText: "Insurance bill" })).toContainText("RBC Chequing");
  await expect(page.locator("li", { hasText: "Insurance bill" })).not.toContainText(
    "Choose account",
  );

  // Journal entries delete like anything else.
  await postEntry("Posted by mistake", "6150 · Insurance", "1010 · RBC Chequing", "10");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText(/deleted/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/accounting\/journal$/);
});

test("transfers: match a suggested pair, unmatch it, match two by hand", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  const add = async (
    kind: "income" | "expense",
    account: string,
    memo: string,
    category: string,
  ) => {
    await page.getByRole("button", { name: `Add ${kind}` }).click();
    await choose(page.locator("#tx-money"), account);
    await page.locator("#tx-memo").fill(memo);
    await choose(page.getByLabel("Category 1", { exact: true }), category);
    await page.getByLabel("Amount 1").fill("250.37");
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(page.getByText("Transaction added")).toBeVisible();
  };
  // Cash taken out of the bank and put in the cash box: two uncategorized transactions.
  await add("expense", "1010 · RBC Chequing", "ATM withdrawal", "6990 · Uncategorized expense");
  await add("income", "1000 · Cash on hand", "Cash float", "4990 · Uncategorized income");

  await expect(page.getByText(/possible transfers? between your accounts/)).toBeVisible();
  const atm = page.locator("li", { hasText: "ATM withdrawal" });
  await expect(atm.getByText("Possible transfer to Cash on hand")).toBeVisible();
  await atm.getByText("Possible transfer to Cash on hand").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Possible transfer", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Match as transfer" }).click();
  await expect(page.getByText("Matched as a transfer", { exact: true })).toBeVisible();
  await expect(page.locator("li", { hasText: "ATM withdrawal" })).toContainText(
    "RBC Chequing → Cash on hand",
  );
  await expect(page.locator("li", { hasText: "Cash float" })).toHaveCount(0);

  // Unmatching brings both back, and they aren't suggested together again.
  await openTransaction(page, "ATM withdrawal");
  await page.getByRole("button", { name: "Unmatch" }).click();
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();
  await expect(page.locator("li", { hasText: "Cash float" })).toBeVisible();
  await expect(page.locator("li", { hasText: "ATM withdrawal" })).not.toContainText(
    "Possible transfer",
  );

  // Picked by hand: tick both, then Match.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator("li", { hasText: "ATM withdrawal" })
    .getByLabel(/^Select/)
    .check({ force: true });
  await page
    .locator("li", { hasText: "Cash float" })
    .getByLabel(/^Select/)
    .check({ force: true });
  await expect(page.getByText(/can be matched as a transfer/)).toBeVisible();
  await page.getByRole("button", { name: "Match as transfer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Match as transfer" }).click();
  await expect(page.getByText("Matched as a transfer", { exact: true })).toBeVisible();
  await expect(page.locator("li", { hasText: "ATM withdrawal" })).toContainText(
    "RBC Chequing → Cash on hand",
  );
});

test("rule suggestions: a payee categorized three times by hand becomes a rule", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  for (const amount of ["15.99", "15.99", "17.99"]) {
    await page.getByRole("button", { name: "Add expense" }).click();
    await choose(page.locator("#tx-money"), "1010 · RBC Chequing");
    await page.locator("#tx-memo").fill("NETFLIX.COM 866-579");
    await choose(
      page.getByLabel("Category 1", { exact: true }),
      "6100 · Software and subscriptions",
    );
    await page.getByLabel("Amount 1").fill(amount);
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(page.getByText("Transaction added").first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.reload();
  await expect(page.getByText(/rules? suggested/)).toBeVisible();
  // A click while the reloaded list is still hydrating can be dropped on slow CI machines.
  await expect(async () => {
    await page.getByRole("link", { name: "See suggestions" }).click();
    await expect(page).toHaveURL(/\/banking\/rules$/, { timeout: 2_000 });
  }).toPass();

  const card = page.getByRole("listitem").filter({ hasText: "“netflix.com”" });
  await expect(card).toContainText("Software and subscriptions");
  await expect(card).toContainText("You categorized 3 like this");
  await card.getByRole("button", { name: "Make this rule" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("When the description contains")).toHaveValue("netflix.com");
  await dialog.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Rule added")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Make this rule" }).filter({ hasText: "netflix" }),
  ).toHaveCount(0);
  await expect(page.getByText("“netflix.com”")).toBeVisible();
});

test("company: profile, registration numbers, people, documents and the compliance calendar", async ({
  page,
}) => {
  const inDays = (n: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
      new Date(Date.now() + n * 86_400_000),
    );
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();

  // Where and when it was incorporated sets the annual return.
  await page.getByRole("button", { name: "Edit" }).click();
  let dialog = page.getByRole("dialog");
  await choose(dialog.locator("#jurisdiction"), "Ontario (OBCA)");
  await dialog.getByLabel("Registered address").fill("1 King St W\nToronto ON");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Company details saved")).toBeVisible();
  await expect(page.getByText("Ontario (OBCA)")).toBeVisible();

  await page.getByRole("button", { name: "Add number" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Number").fill("123456789");
  await dialog.getByRole("button", { name: "Add number" }).click();
  await expect(page.getByText("Number added")).toBeVisible();
  await expect(page.getByText("123456789")).toBeVisible();

  await page.getByRole("button", { name: "Add person" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Sam Director");
  await dialog.getByLabel("Ownership (optional)").fill("100");
  await dialog.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText("Person added")).toBeVisible();
  await expect(page.getByText("100%")).toBeVisible();

  // A document with an expiry date goes on the calendar.
  await page.getByRole("link", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: "Add a document" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Document file").setInputFiles({
    name: "insurance.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
  });
  await dialog.getByLabel("Name").fill("Insurance certificate");
  await dialog.getByLabel("Expires on (optional)").fill(inDays(20));
  await dialog.getByRole("button", { name: "Add document" }).click();
  await expect(page.getByText("Document added")).toBeVisible();
  await expect(page.getByText("Expires in 20 days")).toBeVisible();

  await page.getByRole("link", { name: "Compliance calendar", exact: true }).click();
  await expect(page.getByText("File the T2 corporate income tax return").first()).toBeVisible();
  await expect(page.getByText("File the annual return").first()).toBeVisible();
  await expect(page.getByText("Insurance certificate expires")).toBeVisible();

  await page.getByRole("button", { name: "Add an item" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("What's due?").fill("Renew business licence");
  await dialog.getByLabel("Due on", { exact: false }).fill(inDays(10));
  await choose(dialog.locator("#item-recurrence"), "Once");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added to the calendar")).toBeVisible();
  const licence = page.getByRole("listitem").filter({ hasText: "Renew business licence" });
  await expect(licence).toContainText("In 10 days");
  await licence.getByRole("button", { name: /as done$/ }).click();
  await expect(page.getByText("Marked as done")).toBeVisible();

  // Home shows what's coming up, without the done item.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  const comingUp = page.locator("section", { hasText: "Coming up" });
  await expect(comingUp.getByText("Insurance certificate expires")).toBeVisible();
  await expect(comingUp.getByText("Renew business licence")).toHaveCount(0);
});

test("commerce: connect Amazon Seller Central, choose marketplaces, test and disconnect", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Features", exact: true }).click();
  await page.locator("#module-commerce").click();
  await expect(page.getByText("Commerce switched on")).toBeVisible();
  await page.getByRole("link", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: "Connect Amazon" }).click();

  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("LWA client ID")
    .fill("amzn1.application-oa2-client.e2e0000000000000000000000000000");
  await dialog.getByLabel("LWA client secret").fill("e2e-client-secret-000000");
  // A token that looks right but Amazon refuses.
  await dialog.getByLabel("Refresh token").fill("Atzr|wrong-token");
  await dialog.getByRole("button", { name: "Check and connect" }).click();
  await expect(page.getByText(/didn't accept the refresh token/)).toBeVisible();
  await dialog.getByLabel("Refresh token").fill("Atzr|e2e-refresh-token-0000");
  await dialog.getByRole("button", { name: "Check and connect" }).click();
  await expect(page.getByText("Amazon connected")).toBeVisible();
  await expect(page.getByText("Selling in 1 marketplace")).toBeVisible();

  // Where the seller sells starts switched on; elsewhere starts off.
  await expect(page.getByText("Maple Goods Store", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Bring in orders from Amazon.ca")).toBeChecked();
  await expect(page.getByLabel("Bring in orders from Amazon.com")).not.toBeChecked();
  await page.getByLabel("Bring in orders from Amazon.com").click();
  await expect(page.getByLabel("Bring in orders from Amazon.com")).toBeChecked();

  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Amazon answered")).toBeVisible();

  // It isn't a bank: Bank accounts doesn't list it.
  await page.getByRole("link", { name: "Bank accounts", exact: true }).click();
  await expect(page.getByText("Amazon Seller Central")).toHaveCount(0);

  await page.getByRole("link", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Click again to disconnect" }).click();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Amazon" })).toBeVisible();
});

test("commerce: bring in Amazon orders, find one by SKU and open it", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  // Reconnect (the test before disconnected): the marketplaces start as Amazon has them again.
  await page.getByRole("link", { name: "Channels", exact: true }).click();
  await page.getByRole("button", { name: "Connect Amazon" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("LWA client ID")
    .fill("amzn1.application-oa2-client.e2e0000000000000000000000000000");
  await dialog.getByLabel("LWA client secret").fill("e2e-client-secret-000000");
  await dialog.getByLabel("Refresh token").fill("Atzr|e2e-refresh-token-0000");
  await dialog.getByRole("button", { name: "Check and connect" }).click();
  await expect(page.getByText("Amazon connected")).toBeVisible();
  await expect(page.getByLabel("Bring in orders from Amazon.ca")).toBeChecked();

  // First time: choose the start date, then the orders come in (two pages, then their items).
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bring in your orders" })).toBeVisible();
  const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Bring in orders placed from").fill(start);
  await page.getByRole("button", { name: /^Bring in orders from/ }).click();
  await expect(page.getByText("4 orders brought in")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Maple leaf ceramic mug")).toBeVisible();
  await expect(page.getByText("Pine forest candle")).toBeVisible();
  await expect(page.getByText("To ship", { exact: true })).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true }).last()).toBeVisible();
  // Sales leave out the cancelled order.
  await expect(page.getByText("$91.68")).toBeVisible();

  // The refund Amazon posted shows in red, and the Refunded tab finds the order.
  await expect(page.getByText("Partly refunded", { exact: true })).toHaveCount(1);
  await page.getByRole("link", { name: "Refunded", exact: true }).click();
  await expect(page.getByText("Maple leaf ceramic mug")).toBeVisible();
  await expect(page.getByText("Pine forest candle")).toHaveCount(0);

  await page.getByRole("link", { name: "All orders", exact: true }).click();
  await page.getByLabel("Search orders").fill("PINE-CANDLE");
  await page.getByLabel("Search orders").press("Enter");
  await expect(page.getByText("Maple leaf ceramic mug")).toHaveCount(0);
  await expect(page.getByText("Pine forest candle")).toBeVisible();

  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByText("Maple leaf ceramic mug").click();
  await expect(page.getByRole("heading", { name: "Order 702-1000001-0000001" })).toBeVisible();
  await expect(page.getByText("SKU MAPLE-MUG · ASIN B0E2E00001")).toBeVisible();
  await expect(page.getByText("Prime", { exact: true })).toBeVisible();
  await expect(page.getByText("Partly refunded", { exact: true })).toBeVisible();
  await expect(page.getByText("SKU MAPLE-MUG · 1 unit")).toBeVisible();
  await expect(page.getByText("($22.59)").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Seller Central" })).toHaveAttribute(
    "href",
    "https://sellercentral.amazon.ca/orders-v3/order/702-1000001-0000001",
  );

  // Running it again finds nothing new.
  await page.getByRole("link", { name: "Orders", exact: true }).first().click();
  await page.getByRole("button", { name: "Bring in new orders" }).click();
  await expect(page.getByText("Your orders are up to date")).toBeVisible({ timeout: 30_000 });
});

test("reviews: ask for a review by hand, then turn on automatic requests", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Features", exact: true }).click();
  await page.locator("#module-reviews").click();
  await expect(page.getByText("Review requests switched on")).toBeVisible();

  // Both shipped orders can be asked: the mug (delivered a week ago) and the coaster set, shipped
  // by Amazon (FBA) with no delivery dates, so its window is estimated from the purchase day.
  await page.getByRole("link", { name: "Requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review requests" })).toBeVisible();
  const mug = page.getByRole("listitem").filter({ hasText: "Maple leaf ceramic mug" });
  await expect(mug.getByText(/^Can be asked until/)).toBeVisible();
  const coaster = page.getByRole("listitem").filter({ hasText: "Birch bark coaster set" });
  await expect(coaster.getByText(/^Can be asked until about/)).toBeVisible();
  // The mug was partly refunded (the orders sync found it): it's left out, with no request.
  await mug.getByRole("button", { name: "Ask now" }).click();
  await expect(page.getByText("Refunded or returned").first()).toBeVisible({ timeout: 30_000 });

  // The coaster's order page asks Amazon by itself, and Amazon takes a request.
  await coaster.getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Review request" })).toBeVisible();
  await expect(page.getByText("Ready to ask", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(/Amazon is taking a review request for this order now/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ask for a review now" }).click();
  await expect(page.getByText("Review request sent")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "All review requests" }).click();
  await page.getByRole("link", { name: /^Requested/ }).click();
  await expect(page.getByText(/Requested .* · By hand/)).toBeVisible();

  // Automatic requests: on, from today, leaving out business orders.
  await page.getByRole("link", { name: "Automatic requests", exact: true }).first().click();
  await page.getByLabel("Ask every buyer automatically").click();
  await expect(page.getByText(/^On: 7 days after delivery/)).toBeVisible();
  await page.getByLabel("Skip business orders").click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Automatic requests are on")).toBeVisible();

  // The Orders list and the order show the request.
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByText("Review requested", { exact: true })).toBeVisible();
  await page.getByText("Birch bark coaster set").click();
  await expect(page.getByRole("heading", { name: "Review request" })).toBeVisible();
  await expect(page.getByText("Requested", { exact: true })).toBeVisible();
});

test("settlements: bring in Amazon's settlement report, see the payout, and upload an older one", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Settlements", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settlements" })).toBeVisible();
  await page.getByRole("button", { name: "Bring in settlements" }).click();
  await expect(page.getByText("1 settlement brought in")).toBeVisible({ timeout: 30_000 });

  // The payout and what makes it up, in plain words.
  await page
    .getByRole("link", { name: /Amazon\.ca/ })
    .first()
    .click();
  await expect(page.getByText("What makes up the payout")).toBeVisible();
  await expect(page.getByText("Paid to you")).toBeVisible();
  await expect(page.getByText("$26.03").first()).toBeVisible();
  await expect(page.getByText("Referral fee").first()).toBeVisible();
  await expect(page.getByText("Sponsored ads")).toBeVisible();
  await expect(page.getByText("Held back this period")).toBeVisible();

  // An older settlement, uploaded as Amazon's flat file (read in the browser).
  await page.getByRole("link", { name: "Settlements", exact: true }).first().click();
  const header =
    "settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency\ttransaction-type\torder-id\tmarketplace-name\tamount-type\tamount-description\tamount";
  const file = [
    header,
    "10000000000\t2026-08-01 07:00:00 UTC\t2026-08-15 07:00:00 UTC\t2026-08-17 07:00:00 UTC\t10.00\tCAD",
    "10000000000\t\t\t\t\t\tOrder\t702-0000009-0000009\tAmazon.ca\tItemPrice\tPrincipal\t15.00",
    "10000000000\t\t\t\t\t\tOrder\t702-0000009-0000009\tAmazon.ca\tItemFees\tCommission\t-5.00",
  ].join("\n");
  await page.getByLabel("Settlement files").setInputFiles({
    name: "settlement-august.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(file),
  });
  await expect(page.getByText("1 settlement added")).toBeVisible();
  await expect(page.getByRole("link", { name: /Aug 1, 2026/ })).toBeVisible();

  // Choose the accounts (suggested from their names), then post the Amazon settlement.
  await page.getByRole("link", { name: "How settlements post" }).click();
  await expect(page.getByText(/Suggested from your accounts' names/)).toBeVisible();
  for (const kind of [
    "Amazon clearing (the payout)",
    "Sales tax",
    "Held back and released",
    "Other",
  ]) {
    await choose(page.getByRole("combobox", { name: kind, exact: true }), "1000 · Cash on hand");
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Settlements post with these accounts from now on.")).toBeVisible();
  await page
    .getByRole("link", { name: /Amazon\.ca/ })
    .first()
    .click();
  await expect(page.getByRole("columnheader", { name: "Debit" })).toBeVisible();
  await page.getByRole("button", { name: "Post to books" }).click();
  await expect(page.getByText(/Posted as JE-/)).toBeVisible();
  await expect(page.getByText(/No deposit of \$26\.03 found/)).toBeVisible();

  // The payout reaches the bank, recorded as sales (the Wave way): it's found and matched.
  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Name").fill("Main chequing");
  await page.getByLabel("Code (optional)").fill("1045");
  await choose(page.locator("#currency"), /^CAD · /);
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Account added")).toBeVisible();
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Add income" }).click();
  await choose(page.locator("#tx-money"), /^1045 · Main chequing/);
  await page.locator("#tx-memo").fill("AMAZON.CA DEPOSIT");
  await choose(page.getByLabel("Category 1", { exact: true }), "4000 · Sales");
  await page.getByLabel("Amount 1").fill("26.03");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added").first()).toBeVisible();
  await page.getByRole("link", { name: "Settlements", exact: true }).click();
  await expect(page.getByText("In books · match deposit")).toBeVisible();
  await page
    .getByRole("link", { name: /Amazon\.ca/ })
    .first()
    .click();
  await expect(page.getByText("AMAZON.CA DEPOSIT")).toBeVisible();
  await expect(
    page.getByText(/Now in Sales\. Matching moves it to 1000 · Cash on hand/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Match", exact: true }).click();
  await expect(page.getByText("Deposit matched")).toBeVisible();
  await expect(page.getByText(/Matched to the deposit into Main chequing/)).toBeVisible();
  // Taking it out of the books waits until the deposit is unmatched.
  await page.getByRole("button", { name: "Take out of books" }).click();
  await expect(page.getByText(/Unmatch its bank deposit first/)).toBeVisible();
  await page.getByRole("button", { name: "Unmatch" }).click();
  await expect(page.getByText("Deposit unmatched")).toBeVisible();
  await expect(page.getByText(/No deposit of \$26\.03 found/)).toBeVisible();

  // And out again: its entry is reversed.
  await page.getByRole("button", { name: "Take out of books" }).click();
  await expect(page.getByText("Taken out of your books")).toBeVisible();
  await expect(page.getByRole("button", { name: "Post to books" })).toBeVisible();

  // What each marketplace earned, from its settlements.
  await page.getByRole("link", { name: "Channel profit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Channel profit" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Net from the channel" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Amazon\.ca/ })).toBeVisible();
});

test("commerce: a different seller account's credentials hide the previous account's orders", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByText("Maple leaf ceramic mug")).toBeVisible();

  const replace = async (refreshToken: string) => {
    await page.getByRole("link", { name: "Channels", exact: true }).click();
    await page.getByRole("button", { name: "Replace credentials" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("LWA client ID")
      .fill("amzn1.application-oa2-client.e2e0000000000000000000000000000");
    await dialog.getByLabel("LWA client secret").fill("e2e-client-secret-000000");
    await dialog.getByLabel("Refresh token").fill(refreshToken);
    await dialog.getByRole("button", { name: "Check and replace" }).click();
    await expect(page.getByText("Credentials replaced")).toBeVisible();
  };

  // Another seller in the same region (Amazon doesn't know our orders): it starts fresh.
  await replace("Atzr|e2e-other-seller-0000");
  await expect(page.getByText("Cedar Trading Co", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bring in your orders" })).toBeVisible();
  await expect(page.getByText("Maple leaf ceramic mug")).toHaveCount(0);

  // The first seller again: its marketplaces and orders come back.
  await replace("Atzr|e2e-refresh-token-0000");
  await expect(page.getByText("Maple Goods Store", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByText("Maple leaf ceramic mug")).toBeVisible();
});

test("amounts recorded in CAD on a USD account are flagged and corrected from Wise", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Name").fill("Old USD");
  await page.getByLabel("Code (optional)").fill("1030");
  await choose(page.locator("#currency"), /^CAD · /);
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Account added")).toBeVisible();

  // Recorded in CAD (like Wave's export), then the account is switched to USD.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  // US$100 that arrived, recorded as its CAD value (136.50 at 1.365).
  await page.getByRole("button", { name: "Add income" }).click();
  await choose(page.locator("#tx-money"), /^1030 · Old USD/);
  await page.locator("#tx-memo").fill("Received in US dollars");
  await choose(page.getByLabel("Category 1", { exact: true }), "4000 · Sales");
  await page.getByLabel("Amount 1").fill("136.50");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added").first()).toBeVisible();

  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await page.getByRole("button", { name: "Edit Old USD" }).click();
  await choose(page.locator("#currency"), /^USD · /);
  await expect(page.getByText(/correct them on Banking → Bank accounts/)).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.getByRole("link", { name: "Bank accounts", exact: true }).click();
  await expect(page.getByText("Old USD: 1 amount isn't in USD")).toBeVisible();
  await expect(page.getByText(/Add the bank's USD statements \(PDF\)/)).toBeVisible();

  // Link Wise's USD balance to it (bringing in nothing new), then correct from the statement.
  await page.getByRole("button", { name: "Connect Wise" }).first().click();
  await page.getByLabel("API token").fill("e2e-wise-token-0000-1111-2222");
  await page.getByRole("button", { name: "Continue" }).click();
  await choose(page.getByLabel("Account for the CAD balance"), "Don't bring this one in");
  await choose(page.getByLabel("Account for the USD balance"), /^1030 · Old USD/);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(Date.now() + 86_400_000),
  );
  await page.locator("#sync-from").fill(tomorrow);
  await page.getByRole("button", { name: "Connect 1 balance" }).click();
  await expect(page.getByText("Wise connected")).toBeVisible();

  await page.getByRole("button", { name: "Correct from Wise" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("matched to Wise")).toBeVisible();
  await dialog.getByRole("button", { name: "Correct 1 transaction" }).click();
  await expect(page.getByText("1 transaction corrected")).toBeVisible();
  await expect(page.getByText("Old USD: 1 amount isn't in USD")).toHaveCount(0);
  // The balance Wise reports sits beside the one in the books, and they agree.
  const row = page.locator("li", { hasText: "1030 · Old USD" });
  await expect(row).toContainText(/Bank, .*US\$100\.00/);
  await expect(row).toContainText(/In Bookalyze\s*US\$100\.00/);
  await expect(row).toContainText("Matches");

  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await expect(page).toHaveURL(/accounting\/accounts/);
  await expect(page.locator("li", { hasText: "1030" })).toContainText("US$100.00");
});

test("amounts recorded in CAD on a USD account are corrected from the bank's PDF statements", async ({
  page,
}) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Name").fill("Bank USD");
  await page.getByLabel("Code (optional)").fill("1035");
  await choose(page.locator("#currency"), /^CAD · /);
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Account added")).toBeVisible();

  // US$100 that arrived, recorded as its CAD value (136.50 at 1.365), then switched to USD.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Add income" }).click();
  await choose(page.locator("#tx-money"), /^1035 · Bank USD/);
  await page.locator("#tx-memo").fill("Funds transfer credit");
  await choose(page.getByLabel("Category 1", { exact: true }), "4000 · Sales");
  await page.getByLabel("Amount 1").fill("136.50");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added").first()).toBeVisible();
  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await page.getByRole("button", { name: "Edit Bank USD" }).click();
  await choose(page.locator("#currency"), /^USD · /);
  await page.getByRole("button", { name: "Save changes" }).click();

  // No Wise here: the bank's monthly PDF statement, read in the browser.
  await page.getByRole("link", { name: "Bank accounts", exact: true }).click();
  await expect(page.getByText("Bank USD: 1 amount isn't in USD")).toBeVisible();
  await page.getByRole("button", { name: "Correct from statements" }).click();
  const dialog = page.getByRole("dialog");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    new Date(),
  );
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
  const short = month.slice(0, 3);
  await dialog.getByLabel("Statement PDFs").setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: statementPdf({
      period: `${month} 1, ${y} to ${month} ${new Date(Date.UTC(y, m, 0)).getUTCDate()}, ${y}`,
      opening: "50.00",
      rows: [
        {
          date: `${String(d).padStart(2, "0")} ${short}`,
          text: "Funds transfer credit Example Co",
          into: "100.00",
        },
        { text: "Funds transfer fee Example Co", out: "17.00", balance: "133.00" },
      ],
      closing: "133.00",
    }),
  });
  await expect(dialog.getByText("Balances check out")).toBeVisible();
  await dialog.getByRole("button", { name: "Match 2 transactions" }).click();
  await expect(dialog.getByText("matched", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Correct 1 transaction" }).click();
  await expect(page.getByText("1 transaction corrected")).toBeVisible();
  await expect(page.getByText("Bank USD: 1 amount isn't in USD")).toHaveCount(0);
  await page.getByRole("link", { name: "Chart of accounts", exact: true }).click();
  await expect(page).toHaveURL(/accounting\/accounts/);
  await expect(page.locator("li", { hasText: "1035" })).toContainText("US$100.00");
});

test("invite-only sign-up blocks strangers", async ({ page }) => {
  await signUp(page, "Stranger", `stranger+${run}@example.com`, "some-long-password");
  await expect(page.getByText(/invite-only for now/i).last()).toBeVisible();
  await expect(page).toHaveURL(/sign-up/);
});

test("an invited teammate can sign up and join", async ({ page }) => {
  await signIn(page, owner.email, owner.password);
  await page.getByRole("link", { name: "Team members", exact: true }).click();
  await page.locator("#invite-email").fill(teammate.email);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invitation sent to ${teammate.email}`)).toBeVisible();
  const inviteUrl = await latestLink(teammate.email, "accept-invitation");

  await signOut(page);
  await page.goto(inviteUrl);
  await page.getByRole("link", { name: "Create account" }).click();
  await page.locator("#name").fill(teammate.name);
  await expect(page.locator("#email")).toHaveValue(teammate.email);
  await page.locator("#password").fill(teammate.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await verifyEmail(page, teammate.email);

  await expect(page).toHaveURL(/accept-invitation/);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/o\/maple-goods-/);
  await page.getByRole("link", { name: "Team members", exact: true }).click();
  await expect(page.getByText(`${teammate.name} (you)`)).toBeVisible();
  // Members can't change settings.
  await page.getByRole("link", { name: "Features", exact: true }).click();
  await expect(page.getByText("Only owners and admins can change features.")).toBeVisible();
});

test("a Google-only user can set a password and then sign in with it", async ({ page }) => {
  test.setTimeout(60_000);
  // A real Google round-trip needs live OAuth credentials, so simulate a Google-only account:
  // invite the user, let them sign up, then remove their password login so only Google remains.
  await withOwnerDb((db) =>
    db.query(
      `insert into invitation (organization_id, email, role, status, expires_at, inviter_id)
       select m.organization_id, $1, 'member', 'pending', now() + interval '1 day', m.user_id
       from member m join "user" u on u.id = m.user_id where u.email = $2 limit 1`,
      [googleOnly.email, owner.email],
    ),
  );
  // Sign-up is rate limited per IP (brute-force protection); let the window from earlier tests pass.
  await page.waitForTimeout(11_000);
  await signUp(page, googleOnly.name, googleOnly.email, googleOnly.password);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await verifyEmail(page, googleOnly.email);
  await expect(page).toHaveURL(/\/onboarding/);
  await withOwnerDb(async (db) => {
    const { rows } = await db.query(`select id from "user" where email = $1`, [googleOnly.email]);
    const userId = rows[0].id;
    await db.query(`delete from account where user_id = $1 and provider_id = 'credential'`, [
      userId,
    ]);
    await db.query(
      `insert into account (account_id, provider_id, user_id, created_at, updated_at)
       values ($1, 'google', $2, now(), now())`,
      [`google-sub-${run}`, userId],
    );
  });

  await page.goto("/account/security");
  await expect(page.getByText("You signed up with Google.")).toBeVisible();
  await page.locator("#password").fill("brand-new-password");
  await page.locator("#confirm").fill("brand-new-password");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText(/Password set\. You can now sign in/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();

  await signOut(page);
  await signIn(page, googleOnly.email, "brand-new-password");
  await expect(page).toHaveURL(/\/onboarding/);
});
