import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar, SidebarContent } from "@/components/shell/sidebar";
import { getOrgContext, listUserOrgs } from "@/server/org";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  const orgs = await listUserOrgs(ctx.session.user.id);
  return (
    <div className="flex min-h-dvh">
      <Sidebar ctx={ctx} orgs={orgs} />
      <div className="min-w-0 flex-1">
        <MobileNav>
          <SidebarContent ctx={ctx} orgs={orgs} />
        </MobileNav>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
