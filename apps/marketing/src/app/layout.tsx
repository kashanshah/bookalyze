import { Analytics } from "@vercel/analytics/next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const DESCRIPTION =
  "Accounting built for Amazon, Walmart and Noon sellers (and eBay): every settlement posted, every payout matched to your bank, cost of goods and profit per channel, for every company you run. Free for 30 days.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Bookalyze · Accounting for Amazon, Walmart and Noon sellers",
    template: "%s · Bookalyze",
  },
  description: DESCRIPTION,
  applicationName: "Bookalyze",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Bookalyze",
    url: "/",
    title: "Bookalyze · Accounting built for Amazon, Walmart and Noon sellers",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
  // Favicons follow the browser's light/dark theme; the .ico files cover browsers without SVG icons.
  icons: {
    icon: [
      { url: "/favicon-light.svg", type: "image/svg+xml", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-dark.svg", type: "image/svg+xml", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon-light.ico", sizes: "any", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-dark.ico", sizes: "any", media: "(prefers-color-scheme: dark)" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#13141c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-scroll-behavior: Next.js turns smooth scrolling off while it moves to the top of a new
    // page; without it, opening a page from another glides down to a later section.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
        >
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
