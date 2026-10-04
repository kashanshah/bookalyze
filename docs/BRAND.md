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

## Logo checklist

The logo mark is a rounded square (corner radius ≈ 25% of the width) with a white "B", filled
with the indigo gradient above. When the final logo is ready, replace it in:

1. `apps/web/src/components/brand.tsx`: `BrandMark` (sidebar, auth pages) as inline SVG.
2. `apps/web/src/app/icon.svg`: browser tab icon. Add `apple-icon.png` (180×180) next to it.
3. `apps/web/src/emails/components/layout.tsx`: email header. Emails can't rely on SVG, so use a
   hosted PNG at 2× size (e.g. 64×64 for a 32px mark), or keep the text-based mark.

Deliver it as SVG (mark only, mark + wordmark, white version for dark backgrounds) plus PNGs at
512×512 and 1024×1024.
