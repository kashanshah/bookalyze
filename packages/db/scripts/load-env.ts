import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// The app's env files. Earlier sources win (dotenv never overrides): variables already set in the
// shell, then apps/web/.env.local and apps/web/.env, then the repo-root .env.local and .env (older
// setups), then a package-local .env if present.
for (const file of ["apps/web/.env.local", "apps/web/.env", ".env.local", ".env"]) {
  config({ path: fileURLToPath(new URL(`../../../${file}`, import.meta.url)), quiet: true });
}
config({ quiet: true });
