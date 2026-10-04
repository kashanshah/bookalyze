import { resolve } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// One .env for the whole monorepo: load the repo-root .env. Existing variables (from Vercel or
// apps/web/.env.local) take precedence. On Vercel there is no file and this does nothing.
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@bookalyze/core", "@bookalyze/db"],
  poweredByHeader: false,
};

export default nextConfig;
