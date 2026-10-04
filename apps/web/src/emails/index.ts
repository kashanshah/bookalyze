import { Invitation } from "./invitation";
import { ResetPassword } from "./reset-password";
import { VerifyEmail } from "./verify-email";

/** Templates available in the development preview at /dev/emails. */
export const emailTemplates = {
  "verify-email": { title: "Confirm email address", component: VerifyEmail },
  "reset-password": { title: "Reset password", component: ResetPassword },
  invitation: { title: "Team invitation", component: Invitation },
} as const;

export type EmailTemplateKey = keyof typeof emailTemplates;
