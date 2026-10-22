# Security: access, credentials and incident response

How Teknoffice Technologies Inc. protects Bookalyze and the data it holds for its customers
(their books, bank lines, and the marketplace data they connect: Amazon Selling Partner and
Amazon Ads, Noon, eBay, Walmart, Wise), and what happens when something goes wrong. It applies to
everyone with access to Bookalyze's systems. Today that is one person, the owner.

_Adopted 2026-10-22. Reviewed at least once a year and after every incident (§7)._

---

## 1. Roles

| Role | Who | Contact |
|---|---|---|
| Owner and incident lead | Kashan Shah, Teknoffice Technologies Inc. | kashan@teknoffice.com |

The incident lead decides what counts as an incident, runs the response and sends every
notification in §5. When more people join, this table names a deputy.

## 2. Access and passwords

**Who has access.** Only the owner has access to production: Vercel (the app, its environment
variables and logs), Neon (the database), GitHub (the code and deploy workflow), AWS (S3 file
storage), Resend, Stripe, and the developer consoles of Amazon (Selling Partner, Login with
Amazon, Amazon Ads), eBay, Walmart and Noon. Access is granted per job: someone added later gets
only the systems their work needs, and loses it the day the work ends.

**Minimum password requirements, for people:**
- Every account above has a unique password of at least 14 characters, kept in a password
  manager, never reused and never shared.
- Two-step verification (an authenticator app or a security key) is on wherever the service
  offers it.
- Devices used for this work have disk encryption and a screen lock.

**For systems:**
- **Bookalyze's own passwords** (sign-up, reset, change, and adding one to a Google account)
  follow NIST SP 800-63B, in core `password.ts`, checked in every form and enforced on the server
  (`apps/web/src/server/password-policy.ts`, a Better Auth `hooks.before`):
  - at least **12** characters and at most 128 (any characters, spaces and emoji included);
  - not a common or easily guessed password (common passwords with digits, symbols or swapped
    letters added, keyboard and alphabet runs, repeats, digits only);
  - not the person's name, their email address or "Bookalyze";
  - not in a known data breach: Have I Been Pwned, by k-anonymity (only the first 5 characters
    of the SHA-1 hash leave the server; if the service can't be reached, the password is accepted
    and the miss logged);
  - no composition rules and no forced periodic changes (NIST advises against both); a reset
    signs out every other session. Passwords already set before these rules keep working until
    they're next changed.
  - Accounts are created only after the email is verified, and sign-in is rate-limited.
- Database roles have long random passwords. The app's runtime role can't bypass row-level
  security, so each company sees only its own data.

## 3. Credentials and data protection

- **Secrets live only in Vercel's environment variables** (and GitHub Actions secrets for
  deploys): never in the repository, never in code, never in chat or email. `.env` files are
  ignored by git.
- **Each customer's connection credentials** (refresh tokens, API keys) are encrypted with
  AES-256-GCM under `APP_ENCRYPTION_KEY` before they're stored (`packages/db/src/vault.ts`), and
  never leave the server.
- **In transit:** HTTPS everywhere; the database connection requires TLS (`verify-full`).
- **Tenant isolation:** every customer table has row-level security; queries run inside
  `withOrg()`; a test fails if new code queries tenant data outside it.
- **Logs** never contain credentials or response bodies that may carry them; secret-looking values
  and email addresses are redacted (`redactForLog`).
- **Least data:** marketplace data is used only to serve the customer who connected it. It isn't
  sold or shared; Bookalyze's hosting providers (Vercel, Neon, AWS) process it on our behalf only.
- **Audit log:** every write is recorded in an append-only audit log per company.

## 4. Monitoring and detection

- **Logs:** every server event is a JSON line in Vercel's logs (`event`, company ID, provider
  request ID). Jobs log a summary each run and a line for each failure (`job.*_failed`). Unhandled
  errors are logged once with an error reference (`request.failed`).
- **What to watch for:** sign-ins or activity that wasn't yours on any account in §2; alerts from
  Vercel, Neon, GitHub, AWS or a marketplace; unexpected `*.lwa_refused`, `*.request_failed` 401/403
  bursts, or `vault.unavailable`; a customer reporting data they shouldn't see or changes they
  didn't make; a secret found in a commit, log, screenshot or message.
- **Checks:** the owner reads the logs' error events at least weekly, and keeps each provider's
  security emails going to a monitored inbox.

## 5. Responding to an incident

An incident is any actual or suspected unauthorized access to, use of, or loss of Bookalyze's
systems or customer data, including a leaked secret, even if no harm is confirmed yet.

1. **Record.** Start a private incident note: when it was noticed, by whom, what's known. Keep
   adding to it with times. Keep evidence (logs, screenshots); don't delete anything.
2. **Contain (within the hour).**
   - Leaked or suspected secret: rotate it at the provider, update Vercel's environment variable,
     redeploy. For a Login with Amazon client (Selling Partner or Amazon Ads): generate a new
     client secret in developer.amazon.com and revoke the old one.
   - Compromised account: change its password, sign out every session, re-check two-step
     verification and its recovery options.
   - A customer connection at risk: disconnect it in Bookalyze (its token is deleted) and ask the
     customer to revoke Bookalyze's access at the marketplace and connect again.
   - `APP_ENCRYPTION_KEY` exposed: rotate it; every connection must then be connected again.
   - If needed, pause the app (Vercel) or the scheduled jobs.
3. **Investigate.** Use Vercel's logs, the audit log, the database and the providers' access logs
   to find what was reached, which companies and which data, and since when.
4. **Fix and recover.** Remove the cause, restore from Neon's point-in-time history if data was
   changed, and confirm with tests and logs that it's closed.
5. **Notify**, as soon as the facts allow and within these limits:
   - **Amazon** (any incident involving Amazon information: Selling Partner API or Amazon Ads
     data, or Bookalyze's Amazon credentials): email **security@amazon.com within 24 hours** of
     detecting it, as Amazon's Data Protection Policy requires, with what happened, the data and
     accounts affected, and what was done. Send updates as more is known.
   - **Other marketplaces and providers** (eBay, Walmart, Noon, Wise, Stripe) when their data or
     credentials are involved, through their security contacts and within the times their terms
     set.
   - **Affected customers**, without undue delay: what happened, what data, what we did, what
     they should do (for example, revoke and reconnect a marketplace).
   - **Regulators** where the law requires it: in Canada, a breach creating a real risk of
     significant harm is reported to the Office of the Privacy Commissioner and to the people
     affected, and recorded for 24 months; customers elsewhere (the UAE) are notified under their
     own rules.
6. **Close.** Write down the cause, the impact, the timeline and what changes so it doesn't happen
   again; make those changes.

## 6. Records

Incident notes and every notification sent are kept for at least 24 months, outside the
repository (they may contain customer details).

## 7. Review

This document is reviewed at least once a year, after every incident, and whenever a new kind of
data or provider is added. Once a year the owner walks through §5 for one example (a leaked
Amazon Ads client secret) to check every step still works.
