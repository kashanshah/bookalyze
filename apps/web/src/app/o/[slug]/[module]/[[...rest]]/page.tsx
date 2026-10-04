import { moduleForSegment } from "@bookalyze/core";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MODULE_ICONS } from "@/components/shell/module-icons";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { getOrgContext } from "@/server/org";

/** Placeholder for module pages that are on the roadmap. 404s when the module is switched off. */
export default async function ModulePlaceholderPage({
  params,
}: {
  params: Promise<{ slug: string; module: string; rest?: string[] }>;
}) {
  const { slug, module, rest } = await params;
  const ctx = await getOrgContext(slug);
  const m = moduleForSegment(module);
  if (!m || !ctx.activeModules.includes(m.key)) notFound();
  const path = `${m.basePath}${rest?.length ? `/${rest.join("/")}` : ""}`;
  const item = m.nav.find((n) => n.href === path);
  const Icon = MODULE_ICONS[m.key];
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={item ? m.label : undefined}
        title={item?.label ?? m.label}
        description={m.description}
      />
      <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-16 text-center shadow-xs">
        <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.07]" />
        <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
          <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
            <Icon className="size-7" />
          </span>
          <div>
            <p className="inline-flex items-center gap-1.5 font-semibold text-lg">
              <Sparkles className="size-4 text-primary" />
              Coming in phase {m.phase}
            </p>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
              {m.label} is switched on for {ctx.org.name}. This screen is being built next, and will
              appear here automatically when it's ready.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/o/${slug}`}>Back to home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
