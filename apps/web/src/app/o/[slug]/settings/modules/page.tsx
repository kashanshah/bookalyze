import { MODULE_KEYS, modules } from "@bookalyze/core";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { getOrgContext, isOrgAdmin } from "@/server/org";
import { ModuleList } from "./module-list";

export const metadata: Metadata = { title: "Features" };

export default async function ModulesSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  const items = MODULE_KEYS.map((key) => {
    const m = modules[key];
    return {
      key,
      label: m.label,
      description: m.description,
      requires: m.requires.map((r) => modules[r].label),
      phase: m.phase,
      comingSoon: m.status === "coming_soon",
      allowed: ctx.plan.modules.includes(key),
      enabled: ctx.enabledModules.includes(key),
    };
  });
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Features"
        description={`Switch on only what ${ctx.org.name} uses. Turning a feature off hides it from everyone but keeps all its data, so you can switch it back on any time.`}
      />
      <ModuleList slug={slug} items={items} canEdit={isOrgAdmin(ctx)} planName={ctx.plan.name} />
    </div>
  );
}
