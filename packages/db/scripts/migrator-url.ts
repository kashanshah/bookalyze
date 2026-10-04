/**
 * The owner connection for migrations and seeding: DATABASE_URL_MIGRATOR, else the direct
 * (non-pooled) string Vercel's Neon integration provides, else DATABASE_URL.
 */
export function migratorUrl(): string {
  const url =
    process.env.DATABASE_URL_MIGRATOR ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL_MIGRATOR (or DATABASE_URL) to the owner connection");
  return url;
}
