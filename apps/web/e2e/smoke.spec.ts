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
