# Bookalyze landing page (bookalyze.com)

A static, dependency-free page: plain HTML, CSS and a little JavaScript. Upload this folder as-is.
It will later be replaced by `apps/marketing` (Next.js) when the full marketing site is built.

## Deploy to Hostinger

1. hPanel → **Websites** → your site for `bookalyze.com` → **File Manager**.
2. Open `public_html`, delete the default `default.php`/`index.php` placeholder if present.
3. Upload the **contents** of this folder (not the folder itself): `index.html`, `404.html`,
   `styles.css`, `main.js`, `.htaccess`, `robots.txt`, `sitemap.xml` and the `assets/` folder.
   Tip: upload `bookalyze-landing.zip` and use **Extract** in File Manager. Make sure hidden files
   (`.htaccess`) are included.
4. hPanel → **Security → SSL**: install the free SSL certificate for `bookalyze.com` and `www`.
   `.htaccess` then forces HTTPS and redirects `www` to `bookalyze.com`.

## Collect waitlist sign-ups

Open `main.js` and set `WAITLIST_ENDPOINT` to a form service URL, for example a free
[Formspree](https://formspree.io) form (`https://formspree.io/f/xxxxxxx`). Until then the form
opens the visitor's email app addressed to `WAITLIST_EMAIL` (`hello@bookalyze.com`), so make sure
that mailbox exists (Hostinger → Emails) or change the address.

## Edit

- Text: `index.html` (each section is commented).
- Colours and spacing: the variables at the top of `styles.css` (they match the app's brand, see
  `docs/BRAND.md`). Dark mode follows the visitor's device.
- Social share image: `assets/og-image.png` (1200×630).
