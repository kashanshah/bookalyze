import { resolve } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// Next.js reads apps/web/.env.local and apps/web/.env itself. A repo-root .env.local and .env
// (older setups) also work; earlier sources win, so the app's own files come first. On Vercel
// there are no files and this does nothing.
config({ path: resolve(process.cwd(), "../../.env.local"), quiet: true });
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@bookalyze/core", "@bookalyze/db"],
  poweredByHeader: false,
  // Product analytics (PostHog) through our own domain, so ad blockers don't drop it.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
  // Invoice PDFs read their Arabic font from disk (src/server/pdf-text.ts); ship it with every
  // server function.
  outputFileTracingIncludes: { "/**": ["./src/server/fonts/**"] },
  // The "connect an app" consent screen can't be shown inside another site (clickjacking).
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
