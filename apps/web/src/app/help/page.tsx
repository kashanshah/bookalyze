import { redirect } from "next/navigation";
import { listUserOrgs } from "@/server/org";
import { requireSession } from "@/server/session";

/** The public site's "Still stuck?" link: Help & support in the person's current company. */
export default async function HelpRedirect() {
  const session = await requireSession("/help");
  const orgs = await listUserOrgs(session.user.id);
  const active = orgs.find((o) => o.id === session.session.activeOrganizationId) ?? orgs[0];
  redirect(active ? `/o/${active.slug}/help` : "/onboarding");
}
