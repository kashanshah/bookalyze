import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { choose, latestLink, signIn, signOut, signUp, verifyEmail, withOwnerDb } from "./helpers";

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
  await choose(page.locator("#countryCode"), "Canada");
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
  await expect(page.getByRole("link", { name: "Orders", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByText("Coming in phase 3")).toBeVisible();

  await page.getByRole("link", { name: "Features", exact: true }).click();
  await page.locator("#module-commerce").click();
  await expect(page.getByText("Commerce switched off")).toBeVisible();
  await expect(page.getByRole("link", { name: "Orders", exact: true })).toHaveCount(0);
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
  await page.getByText("Client payment").click();
  await expect(page.getByRole("heading", { name: "Edit transaction" })).toBeVisible();
  await page.getByLabel("Amount 1").fill("850");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Transaction updated")).toBeVisible();
  await expect(
    page.locator("li", { hasText: "Client payment" }).getByText("+$850.00"),
  ).toBeVisible();

  // Remove.
  await choose(page.getByLabel("Status"), "Reviewed or not");
  await page.getByText("Supplies and shipping").click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Click again to remove" }).click();
  await expect(page.getByText("Transaction removed")).toBeVisible();
  await expect(page.getByText("Supplies and shipping")).toHaveCount(0);

  // One account at a time, with its balance: 5,000 + 850.
  await choose(page.getByLabel("Account", { exact: true }), "1010 · RBC Chequing");
  await expect(page.getByText("RBC Chequing balance")).toBeVisible();
  await expect(page.getByText("$5,850.00")).toBeVisible();
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
  await payment.getByText("Client payment", { exact: true }).click();
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
  await expect(page.getByText("Sales · Northwind Traders")).toBeVisible();

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
  await expect(page.getByText("Office supplies · Office Depot")).toBeVisible();

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
  await page.locator("li", { hasText: "Website sale" }).getByRole("button").first().click();
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
  await page.locator("li", { hasText: "Website sale" }).getByRole("button").first().click();
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
  await expect(page.getByText("Already in your books")).toBeVisible();

  // Disconnecting deletes the token and keeps what was brought in.
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Disconnected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Wise" })).toBeVisible();
  await page.goto(transactionsUrl);
  await expect(page.getByText("Converted 136.50 CAD to 100.00 USD")).toBeVisible();
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
