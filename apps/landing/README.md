# Bookalyze landing page (bookalyze.com)

A static, dependency-free page: plain HTML, CSS and a little JavaScript. Upload this folder as-is.
It will later be replaced by `apps/marketing` (Next.js) when the full marketing site is built.

## Deploy to Hostinger

1. hPanel → **Websites** → your site for `bookalyze.com` → **File Manager**.
2. Open `public_html`, delete the default `default.php`/`index.php` placeholder if present.
3. Upload the **contents** of this folder (not the folder itself): `index.html`, `404.html`,
   `styles.css`, `main.js`, `subscribe.php`, `.htaccess`, `robots.txt`, `sitemap.xml` and the
   `assets/` folder.
   Tip: upload `bookalyze-landing.zip` and use **Extract** in File Manager. Make sure hidden files
   (`.htaccess`) are included.
4. hPanel → **Security → SSL**: install the free SSL certificate for `bookalyze.com` and `www`.
   `.htaccess` then forces HTTPS and redirects `www` to `bookalyze.com`.

## Collect waitlist sign-ups (Resend)

Sign-ups go to `subscribe.php`, which adds each email to **Resend Contacts** and your waitlist
segment. Your Resend API key stays in a file outside the website folder.

1. **Resend:** verify the `bookalyze.com` domain (Domains), then go to **Audience → Segments** and
   create a segment called `Waitlist`. Copy its ID.
2. **Resend → API Keys:** create a key that can manage contacts. Copy it.
3. **Hostinger → File Manager:** in the folder **above** `public_html` (your home folder), upload
   `bookalyze-config.example.php`, rename it to `bookalyze-config.php`, and fill in the key and
   segment ID. Never put this file inside `public_html`.
4. Submit the form on the live site, then check that your email appears in Resend → Audience.

Notes:
- PHP 8.1 or newer is required (Hostinger's default is fine). If your hosting layout differs, the
  script also reads `RESEND_API_KEY` and `RESEND_SEGMENT_ID` from environment variables.
- Spam protection: a hidden honeypot field and a limit of 5 attempts per visitor per 10 minutes.
- Someone signing up twice is fine; they're told they're already on the list.
- Consent: the form says people will only get Bookalyze emails and can unsubscribe anytime.
  Resend Broadcasts add an unsubscribe link automatically, which keeps you within Canada's
  anti-spam law (CASL).
- To announce early access, send a **Broadcast** in Resend to the `Waitlist` segment.

## Edit

- Text: `index.html` (each section is commented).
- Colours and spacing: the variables at the top of `styles.css` (they match the app's brand, see
  `docs/BRAND.md`). Dark mode follows the visitor's device.
- Social share image: `assets/og-image.png` (1200×630).
