# Bookalyze brand & colour theme

The app's colours are defined once as CSS variables in `apps/web/src/app/globals.css`
(in `oklch`, which gives even, predictable shades). Hex equivalents are below for design tools
(Figma, Canva, Lovable) and for emails, which need hex.

## Brand

| Role | Hex | oklch | Use |
|---|---|---|---|
| **Primary (brand indigo)** | `#4C55CA` | `oklch(0.51 0.18 275)` | Buttons, links, active states, the logo |
| Logo gradient, light end | `#606CDD` | `oklch(0.58 0.17 275)` | Top-left of the logo mark |
| Logo gradient, dark end | `#373BA7` | `oklch(0.42 0.17 275)` | Bottom-right of the logo mark |
| Deep indigo | `#2B2D89` | `oklch(0.36 0.15 275)` | Sign-in brand panel background |
| Glow violet | `#955BE3` | `oklch(0.60 0.20 300)` | Decorative glow on the brand panel |
| Glow blue | `#0079CE` | `oklch(0.55 0.18 240)` | Decorative glow on the brand panel |
| Primary on dark | `#7E8EF4` | `oklch(0.68 0.15 275)` | Primary colour in dark mode |
| Indigo tint | `#ECEFFE` | `oklch(0.955 0.02 275)` | Soft highlights and selected items |

## Neutrals

| Role | Light mode | Dark mode |
|---|---|---|
| Text (ink) | `#14151F` | `#F1F1F5` |
| Muted text | `#696B78` | `#9C9EA8` |
| Border | `#E6E6EA` | `#2A2B32` |
| Page background | `#FBFCFD` | `#0E0F15` |
| Sidebar | `#F9F9FC` | `#111218` |
| Cards | `#FFFFFF` | `#16171E` |

## Status

| Role | Hex | Use |
|---|---|---|
| Success | `#02985F` | Saved, connected, completed |
| Warning | `#E49E22` | Needs attention |
| Destructive | `#DB2B33` | Errors, delete actions |

## Typography

**Geist Sans** (UI) and **Geist Mono** (numbers/code), bundled with the app. Free and open source
(SIL OFL) from Vercel, so it can also be used in the logo wordmark.

## Logo

The logo is a **"BA" monogram**: the B for books, and an A shaped like a mountain with a rising
chart arrow and bars for analysis, followed by the **Bookalyze** wordmark. Source files are in
`docs/brand/logo/`:

| File | Use |
|---|---|
| `bookalyze-logo-light.svg` | Full logo on light backgrounds (indigo gradient `#606CDD → #373BA7`, wordmark `#14151F`) |
| `bookalyze-logo-dark.svg` | Full logo on dark backgrounds (gradient `#7E8EF4 → #606CDD`, wordmark `#F1F1F5`) |
| `bookalyze-logo-white.svg` | All-white logo for indigo or photo backgrounds |
| `bookalyze-icon-light.svg` / `-dark.svg` / `-white.svg` | The monogram on its own |
| `favicon-light.svg` / `.ico`, `favicon-dark.svg` / `.ico` | Browser tab icons for light and dark browser themes |

**In the app** (`apps/web/public`):
- `brand/logo-*.svg` and `brand/mark-*.svg` are tightly cropped copies used by the `Brand` and
  `BrandMark` components (`apps/web/src/components/brand.tsx`), which switch light/dark with the theme.
- Favicons are wired up in `apps/web/src/app/layout.tsx`.
- `apple-touch-icon.png`, `icon-192.png` and `icon-512.png` are the home-screen and app icons
  (white monogram on the indigo gradient).
- `brand/logo-email.png` is the email header logo. Email clients don't render SVG reliably, so it's
  a 2× PNG, served from the app's domain.

To regenerate the PNGs after a logo change, render the SVGs at the sizes above, or ask Claude Code
to do it.

**Usage**
- Keep clear space around the logo of at least the height of the wordmark's "o".
- Minimum size: full logo 96px wide on screen; monogram 16px.
- Don't recolour, stretch, rotate, add effects, or put the light logo on dark backgrounds.
