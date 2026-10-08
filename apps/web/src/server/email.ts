import "server-only";
import { appendFile } from "node:fs/promises";
import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { Resend } from "resend";
import { env } from "./env";
import { logError } from "./log";

export type Email = { to: string; subject: string; react: ReactElement };

/**
 * Renders a React Email template to HTML and plain text and sends it through Resend.
 * In development without RESEND_API_KEY, or whenever EMAIL_DEV_LOG=true, the plain-text
 * version is printed and appended to .dev-mail.log so links can be followed.
 */
export async function sendEmail({ to, subject, react }: Email): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM, NODE_ENV, EMAIL_DEV_LOG } = env();
  const [html, text] = await Promise.all([render(react), render(react, { plainText: true })]);

  if (!RESEND_API_KEY || EMAIL_DEV_LOG) {
    if (NODE_ENV === "production" && !EMAIL_DEV_LOG) {
      logError("email.not_configured", new Error("RESEND_API_KEY is not set"), { subject, to });
      return;
    }
    const entry = `--- ${new Date().toISOString()}\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`;
    console.info(`[dev email]\n${entry}`);
    await appendFile(".dev-mail.log", entry);
    return;
  }

  const resend = new Resend(RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, html, text });
  if (error) {
    // Resend's error name says why (validation_error, rate_limit_exceeded…). The address is
    // masked in the log.
    logError("email.send_failed", error, { subject, to, resendError: error.name });
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
