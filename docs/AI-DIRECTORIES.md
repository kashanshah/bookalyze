# Listing Bookalyze in ChatGPT, Claude and Gemini

Today people add Bookalyze to their assistant as a **custom connector** (paste a link). Once Bookalyze
is listed in an assistant's own directory, people find it there and press **Connect**: no link,
straight to Bookalyze's consent page. This is how to get listed. Checked 2026-11-19.

What Bookalyze already has, which all three require:

- A remote MCP server over HTTPS, Streamable HTTP: `https://app.bookalyze.com/api/mcp`.
- OAuth 2.1: protected-resource and authorization-server metadata, dynamic client registration,
  PKCE S256, `resource` checked, `iss` on every authorization response, refresh rotation,
  `invalid_grant` for a bad refresh token, revocation. Any https redirect is accepted (Claude,
  ChatGPT and Google's callbacks), and loopback on any port (Claude Code).
- Every tool has a title and `readOnlyHint` / `destructiveHint` / `openWorldHint: false`. Reading and
  changing are separate tools (`read_app_action` and `call_app_action` for the screens' actions).
- Server name, website and icons in MCP `serverInfo`; icons at `/connector-icon.png` (256 px) and
  `/icon-512.png`.
- A privacy policy section on AI assistants (`/privacy-policy`, "AI assistants and API access").

When a listing is approved, set its URL so **Settings → AI assistants → Connect** opens the listing
instead of the custom-connector steps (Vercel, Production), then redeploy:

| Variable | Example |
|---|---|
| `CLAUDE_DIRECTORY_URL` | `https://claude.ai/directory/connectors/bookalyze` |
| `CHATGPT_DIRECTORY_URL` | the listing link from OpenAI's publish page |
| `GEMINI_DIRECTORY_URL` | once Google's preview lists us |

## Before submitting anywhere

1. A **demo account** reviewers can sign in to: a Bookalyze user with a company holding sample data
   (transactions, a bank account, a month to reconcile). It must sign in with email and password, with
   no two-step code or magic link, from anywhere. Keep its password out of the repository; it goes in
   each portal's reviewer form.
2. A **demo video** (2–3 minutes, unlisted link): connect from the assistant, the consent page,
   then a read (profit last month) and a write (categorise a transaction) with the confirmation.
3. Test every tool once as a custom connector in each assistant (the Claude portal asks you to confirm
   this).
4. Read the new privacy policy section ("AI assistants and API access") and adjust it if needed.

## Claude (Anthropic): Connectors Directory

- **Who can submit:** any paid Claude plan (Pro, Max, Team, Enterprise; on Team/Enterprise, an Owner).
- **Where:** https://claude.ai/directory/manage → **Submit new** → **MCP connector**.
- **What happens:** an automated policy scan, then it's listed as **Community**. Anthropic may later
  escalate it to **Verified** review (a reviewer tests each tool and emails for the demo account).
- **Listing page:** `https://claude.ai/directory/connectors/<slug>`. The slug is permanent: use
  `bookalyze`.
- **Fill in:**
  - Server URL: `https://app.bookalyze.com/api/mcp`. Authentication: OAuth, dynamic client
    registration (CIMD can stay off).
  - Name: `Bookalyze`.
  - One-liner (200 max): `Ask about your books and have Claude do the bookkeeping: reports, transactions, reconciliation and statements, under your own access rules.`
  - Description (2,000 max): use the ChatGPT long description below.
  - Categories: Finance, Productivity (or the nearest the form offers).
  - Primary use cases: month-end close in conversation; answering "how are we doing" from live
    numbers; categorising and reconciling.
  - Documentation: https://bookalyze.com/guides/connect-claude
  - Privacy policy: https://app.bookalyze.com/privacy-policy. Support: https://bookalyze.com/contact.
  - Icon: `apps/web/public/icon-512.png`.
- **Network:** Claude calls from `160.79.104.0/21`. Nothing blocks it today; keep it that way if a
  firewall rule is ever added on Vercel.
- Docs: https://claude.com/docs/connectors/building/submission

Until it's listed, **Connect Claude** opens Claude's add-connector form with Bookalyze's name and link
already filled in.

## ChatGPT (OpenAI): Plugin directory

- **Who can submit:** the owner of an OpenAI Platform organisation with **identity verification**
  done (individual or business: publish as Teknoffice Technologies Inc.). Platform → Settings →
  Organization → Verification.
- **Domain check:** the dashboard gives a token. Set it as `OPENAI_APPS_CHALLENGE` in Vercel
  (Production) and redeploy; Bookalyze then serves it at
  `https://app.bookalyze.com/.well-known/openai-apps-challenge`.
- **The package** is in `integrations/chatgpt-plugin/` (`plugin.json`, `mcp.json`, `assets/logo.png`).
  Before uploading:
  - Replace `demo_recording_url` with the demo video link.
  - Check `publication.countries` (now Canada and the US) and `category` (the dashboard lists them).
  - Zip it: `cd integrations/chatgpt-plugin && zip -r ../../bookalyze-chatgpt.zip .` (don't commit the zip).
- **Where:** https://platform.openai.com/plugins → **Upload new or existing plugin**.
- **In the dashboard, not the zip:** the demo account under **Review details**, and the attestations.
- **Rules to keep:** no plan, upgrade or pricing promotion in any tool's text or output; no payment
  card or government ID data. Changing the MCP URL later needs OpenAI support.
- After approval, press **Publish plugin**, copy the listing link into `CHATGPT_DIRECTORY_URL`.
- Docs: https://developers.openai.com/plugins/deploy/submission

## Gemini (Google): Connected Apps

- There's no open directory yet. Google's **Connected Apps** preview (October 2026) lists apps in the
  Gemini app and Search, by application, US developers first.
- **Apply:** https://connected.google.com/console/help/?apply
- **One difference to plan for:** Google asks that refresh tokens are not rotated (the same refresh
  token, its expiry extended). Bookalyze rotates them, which Claude and ChatGPT expect. If accepted,
  keep rotation for everyone else and turn it off for Google's client only.
- Until then, Gemini users add Bookalyze as a custom app (Settings → Connected apps), as the app's
  steps say.
- Docs: https://developers.google.com/connected-apps/mcp
