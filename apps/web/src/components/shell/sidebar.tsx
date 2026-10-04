import { modules } from "@bookalyze/core";
import { Blocks, Home, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import type { OrgContext } from "@/server/org";
import { MODULE_ICONS } from "./module-icons";
import { NavLink } from "./nav-link";
import { OrgSwitcher } from "./org-switcher";
import { UserMenu } from "./user-menu";

type OrgItem = { slug: string; name: string; role: string };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
      {children}
    </p>
  );
}

export function SidebarContent({ ctx, orgs }: { ctx: OrgContext; orgs: OrgItem[] }) {
  const base = `/o/${ctx.org.slug}`;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <OrgSwitcher current={ctx.org} orgs={orgs} />
      <nav
        className="-mx-1 grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-1"
        aria-label="Main"
      >
        <div className="grid gap-0.5">
          <NavLink href={base} exact>
            <Home />
            Home
          </NavLink>
        </div>
        {ctx.activeModules.length ? (
          <div className="grid gap-0.5">
            <SectionLabel>Workspace</SectionLabel>
            {ctx.activeModules.map((key) => {
              const m = modules[key];
              const Icon = MODULE_ICONS[key];
              return (
                <div key={key} className="grid gap-0.5">
                  <NavLink href={`${base}${m.basePath}`}>
                    <Icon />
                    <span className="flex-1">{m.label}</span>
                  </NavLink>
                  {m.nav.length > 1 ? (
                    <div className="ms-[22px] grid gap-0.5 border-s ps-2">
                      {m.nav.map((item) => (
                        <NavLink
                          key={item.href}
                          href={`${base}${item.href}`}
                          className="py-1 text-[13px]"
                        >
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="grid gap-0.5">
          <SectionLabel>Settings</SectionLabel>
          <NavLink href={`${base}/settings/general`}>
            <Settings2 />
            Company settings
          </NavLink>
          <NavLink href={`${base}/settings/modules`}>
            <Blocks />
            Features
          </NavLink>
          <NavLink href={`${base}/settings/members`}>
            <Users />
            Team members
          </NavLink>
        </div>
      </nav>
      <div className="border-t pt-3">
        <UserMenu name={ctx.session.user.name} email={ctx.session.user.email} />
      </div>
    </div>
  );
}

export function Sidebar({ ctx, orgs }: { ctx: OrgContext; orgs: OrgItem[] }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col gap-5 border-e bg-sidebar px-3 pt-4 pb-3 lg:flex">
      <Link href="/" className="flex items-center px-2 pt-0.5" aria-label="Bookalyze home">
        <Brand className="h-[26px]" />
      </Link>
      <SidebarContent ctx={ctx} orgs={orgs} />
    </aside>
  );
}
