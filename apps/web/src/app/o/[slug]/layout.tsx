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
      {/* Printouts (and saved PDFs) are just the page: no navigation. */}
      <div className="contents print:hidden">
        <Sidebar ctx={ctx} orgs={orgs} />
      </div>
      <div className="min-w-0 flex-1">
        {/* display: contents keeps the bar sticky inside the column. */}
        <div className="contents print:hidden">
          <MobileNav>
            <SidebarContent ctx={ctx} orgs={orgs} />
          </MobileNav>
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:px-10 lg:py-10 print:max-w-none print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
