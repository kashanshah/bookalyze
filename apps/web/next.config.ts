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
  // Invoice PDFs read their Arabic font from disk (src/server/pdf-text.ts); ship it with every
  // server function.
  outputFileTracingIncludes: { "/**": ["./src/server/fonts/**"] },
};

export default nextConfig;
