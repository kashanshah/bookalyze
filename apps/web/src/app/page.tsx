import { redirect } from "next/navigation";
import { listUserOrgs } from "@/server/org";
import { getSession } from "@/server/session";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const orgs = await listUserOrgs(session.user.id);
  const active = orgs.find((o) => o.id === session.session.activeOrganizationId) ?? orgs[0];
  redirect(active ? `/o/${active.slug}` : "/onboarding");
}
