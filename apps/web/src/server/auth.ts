import "server-only";
import { getDb, schema } from "@bookalyze/db";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { and, eq, gt, sql } from "drizzle-orm";
import { Invitation } from "@/emails/invitation";
import { ResetPassword } from "@/emails/reset-password";
import { VerifyEmail } from "@/emails/verify-email";
import { sendEmail } from "./email";
import { env } from "./env";

/**
 * Sign-ups are invite-only unless SIGNUP_MODE=open. Platform admins and anyone with a pending
 * invitation may always create an account (by email/password or Google).
 */
async function assertSignupAllowed(email: string) {
  const { SIGNUP_MODE, PLATFORM_ADMIN_EMAILS } = env();
  const normalized = email.trim().toLowerCase();
  if (SIGNUP_MODE === "open" || PLATFORM_ADMIN_EMAILS.includes(normalized)) return;
  const [invite] = await getDb()
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        eq(sql`lower(${schema.invitation.email})`, normalized),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!invite) {
    throw new APIError("FORBIDDEN", {
      message: "Bookalyze is invite-only for now. Ask an organization owner to invite you.",
    });
  }
}

function createAuth() {
  const e = env();
  const google =
    e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: e.GOOGLE_CLIENT_ID,
            clientSecret: e.GOOGLE_CLIENT_SECRET,
            prompt: "select_account" as const,
          },
        }
      : {};

  return betterAuth({
    appName: "Bookalyze",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
        twoFactor: schema.twoFactor,
      },
    }),
    advanced: { database: { generateId: "uuid" } },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your Bookalyze password",
          react: ResetPassword({ name: user.name, url }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your email for Bookalyze",
          react: VerifyEmail({ name: user.name, url }),
        });
      },
    },
    socialProviders: google,
    account: {
      // Signing in with Google using the email of an existing account links the two
      // instead of creating a duplicate user (Google verifies email ownership).
      accountLinking: { enabled: true, trustedProviders: ["google", "email-password"] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            await assertSignupAllowed(user.email);
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        invitationExpiresIn: 60 * 60 * 24 * 7,
        sendInvitationEmail: async ({ id, email, role, organization: org, inviter }) => {
          await sendEmail({
            to: email,
            subject: `${inviter.user.name} invited you to ${org.name} on Bookalyze`,
            react: Invitation({
              inviterName: inviter.user.name,
              inviterEmail: inviter.user.email,
              organizationName: org.name,
              role,
              url: `${e.BETTER_AUTH_URL}/accept-invitation/${id}`,
            }),
          });
        },
      }),
      twoFactor({ issuer: "Bookalyze" }),
      ...(e.OAUTH_PROXY_PRODUCTION_URL
        ? [oAuthProxy({ productionURL: e.OAUTH_PROXY_PRODUCTION_URL })]
        : []),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __bookalyzeAuth?: Auth };

/** The Better Auth instance, created on first use so builds don't need runtime secrets. */
export function getAuth(): Auth {
  globalForAuth.__bookalyzeAuth ??= createAuth();
  return globalForAuth.__bookalyzeAuth;
}
