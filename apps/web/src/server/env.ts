import "server-only";
import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** The runtime role. Preferred over DATABASE_URL when a host manages that one (Vercel + Neon). */
    APP_DATABASE_URL: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32, "Generate one with: openssl rand -base64 32"),
    BETTER_AUTH_URL: z.url(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("Bookalyze <no-reply@bookalyze.com>"),
    /** Write emails to .dev-mail.log instead of sending them (local/CI testing without Resend). */
    EMAIL_DEV_LOG: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    SIGNUP_MODE: z.enum(["invite_only", "open"]).default("invite_only"),
    PLATFORM_ADMIN_EMAILS: z
      .string()
      .default("")
      .transform((v) =>
        v
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    /** Production URL that handles OAuth callbacks for preview deployments (Better Auth OAuth proxy). */
    OAUTH_PROXY_PRODUCTION_URL: z.url().optional(),
    /** Receipts and documents. See docs/SETUP.md for the bucket, CORS and IAM setup. */
    AWS_REGION: z.string().default("ca-central-1"),
    AWS_S3_BUCKET: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    /** Secret Vercel Cron sends as a bearer token to scheduled routes (e.g. the daily FX sync). */
    CRON_SECRET: z.string().min(16).optional(),
    /** "s3", or "local" to keep files on disk (development and CI only). */
    STORAGE_DRIVER: z.enum(["s3", "local", ""]).optional(),
  })
  .refine((e) => e.APP_DATABASE_URL || e.DATABASE_URL, {
    message: "Set APP_DATABASE_URL (or DATABASE_URL) to the app's runtime role",
    path: ["APP_DATABASE_URL"],
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Read lazily so `next build` works without runtime secrets. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isGoogleEnabled(): boolean {
  const e = env();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}
