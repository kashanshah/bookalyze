import { resolve } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// One set of env files for the whole monorepo: the repo-root .env.local, then .env. Earlier
// sources win: existing variables (Vercel, apps/web/.env.local) first, then .env.local, then
// .env. On Vercel there are no files and this does nothing.
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
