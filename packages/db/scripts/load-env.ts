import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// One set of env files for the whole monorepo. Earlier sources win (dotenv never overrides):
// variables already set in the shell, then the repo-root .env.local, then the repo-root .env,
// then a package-local .env if present.
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
config({ quiet: true });
