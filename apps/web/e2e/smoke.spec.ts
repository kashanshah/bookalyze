import { expect, test } from "@playwright/test";
import { latestLink, signIn, signOut, signUp, verifyEmail, withOwnerDb } from "./helpers";

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
  await page.locator("#countryCode").selectOption("AE");
  await expect(page.locator("#baseCurrency")).toHaveValue("AED");
  await page.locator("#countryCode").selectOption("CA");
  await expect(page.locator("#baseCurrency")).toHaveValue("CAD");
  await page.locator("#subdivisionCode").selectOption("CA-ON");
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
    await page.getByLabel("Account for line 1").selectOption({ label: debit });
    await page.getByLabel("Debit").nth(0).fill(amount);
    await page.getByLabel("Account for line 2").selectOption({ label: credit });
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
  await page.getByRole("link", { name: "All reports" }).click();
  await page.getByRole("link", { name: /Profit and loss/ }).click();
  await expect(page.getByText("Net loss")).toBeVisible();
  await page.getByRole("link", { name: "All reports" }).click();
  await page.getByRole("link", { name: /Balance sheet/ }).click();
  await expect(page.getByText("Assets equal liabilities plus equity.")).toBeVisible();
  await expect(page.getByText("Profit for this financial year")).toBeVisible();

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
  await page.locator("#tx-money").selectOption({ label: "1010 · RBC Chequing" });
  await page.locator("#tx-memo").fill("Client payment");
  await page.getByLabel("Category 1", { exact: true }).selectOption({ label: "4000 · Sales" });
  await page.getByLabel("Amount 1").fill("800");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();
  const payment = page.locator("li", { hasText: "Client payment" });
  await expect(payment.getByText("+$800.00")).toBeVisible();

  // Money out, split across two categories.
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.locator("#tx-money").selectOption({ label: "1010 · RBC Chequing" });
  await page.locator("#tx-memo").fill("Supplies and shipping");
  await page
    .getByLabel("Category 1", { exact: true })
    .selectOption({ label: "6250 · Office supplies" });
  await page.getByLabel("Amount 1").fill("40");
  await page.getByRole("button", { name: "Split into categories" }).click();
  await page
    .getByLabel("Category 2", { exact: true })
    .selectOption({ label: "6400 · Shipping and postage" });
  await page.getByLabel("Amount 2").fill("25.50");
  await expect(page.getByText("$65.50")).toBeVisible();
  await page.getByRole("button", { name: "Add transaction" }).click();
  const supplies = page.locator("li", { hasText: "Supplies and shipping" });
  await expect(supplies.getByText("Split (2)")).toBeVisible();
  await expect(supplies.getByText("−$65.50")).toBeVisible();

  // Review, and filter by status.
  await payment.getByRole("button", { name: /as reviewed/ }).click();
  await expect(payment.getByRole("button", { name: /as not reviewed/ })).toBeVisible();
  await page.getByLabel("Status").selectOption("unreviewed");
  await expect(page.getByText("Supplies and shipping")).toBeVisible();
  await expect(page.getByText("Client payment")).toHaveCount(0);
  await page.getByLabel("Status").selectOption("reviewed");
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
  await page.getByLabel("Status").selectOption("");
  await page.getByText("Supplies and shipping").click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Click again to remove" }).click();
  await expect(page.getByText("Transaction removed")).toBeVisible();
  await expect(page.getByText("Supplies and shipping")).toHaveCount(0);

  // One account at a time, with its balance: 5,000 + 850.
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "1010 · RBC Chequing" });
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
  await page.locator("#tx-money").selectOption({ label: "1010 · RBC Chequing" });
  await page.locator("#tx-memo").fill("Printer paper");
  await page
    .getByLabel("Category 1", { exact: true })
    .selectOption({ label: "6250 · Office supplies" });
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
  await page.locator("#tx-money").selectOption({ label: "1010 · RBC Chequing" });
  await page.locator("#tx-memo").fill("Consulting invoice 101");
  await page.locator("#tx-contact").selectOption({ label: "Northwind Traders" });
  await page.getByLabel("Category 1", { exact: true }).selectOption({ label: "4000 · Sales" });
  await page.getByLabel("Amount 1").fill("1500");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Sales · Northwind Traders")).toBeVisible();

  // Money out to a vendor created on the spot.
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.locator("#tx-money").selectOption({ label: "1010 · RBC Chequing" });
  await page.locator("#tx-memo").fill("Toner");
  await page.locator("#tx-contact").selectOption({ label: "+ Add a new vendor…" });
  await page.locator("#tx-new-contact").fill("Office Depot");
  await page.locator("#tx-new-contact").press("Enter");
  await expect(page.getByText("Office Depot added")).toBeVisible();
  await expect(page.locator("#tx-contact")).toHaveValue(/[0-9a-f-]{36}/);
  await page
    .getByLabel("Category 1", { exact: true })
    .selectOption({ label: "6250 · Office supplies" });
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
