import { Lock } from "lucide-react";
import Link from "next/link";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar, SidebarContent } from "@/components/shell/sidebar";
import { moduleLabel } from "@/server/billing";
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
          {ctx.billing.readOnly.length ? (
            <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm print:hidden">
              <Lock className="size-4 shrink-0" />
              <span className="flex-1">
                Read-only, because they aren't in the plan:{" "}
                <span className="font-medium">
                  {ctx.billing.readOnly.map(moduleLabel).join(", ")}
                </span>
                . Nothing in them is deleted.
              </span>
              <Link
                href={`/o/${slug}/settings/billing`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Plan and billing
              </Link>
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
