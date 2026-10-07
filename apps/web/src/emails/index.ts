import { ComplianceReminder } from "./compliance-reminder";
import { Invitation } from "./invitation";
import { ListingChanges } from "./listing-changes";
import { ResetPassword } from "./reset-password";
import { VerifyEmail } from "./verify-email";

/** Templates available in the development preview at /dev/emails. */
export const emailTemplates = {
  "verify-email": { title: "Confirm email address", component: VerifyEmail },
  "reset-password": { title: "Reset password", component: ResetPassword },
  invitation: { title: "Team invitation", component: Invitation },
  "compliance-reminder": { title: "Compliance reminder", component: ComplianceReminder },
  "listing-changes": { title: "Listing changes", component: ListingChanges },
} as const;

export type EmailTemplateKey = keyof typeof emailTemplates;
