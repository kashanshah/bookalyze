import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// One .env for the whole monorepo: the repo-root .env, then a package-local .env if present.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
config({ quiet: true });
