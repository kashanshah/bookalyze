import "./scripts/load-env";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    // Migrations run as the owner role; the app connects with DATABASE_URL (RLS enforced).
    url: process.env.DATABASE_URL_MIGRATOR ?? "",
  },
  entities: { roles: false },
  strict: true,
  verbose: true,
});
