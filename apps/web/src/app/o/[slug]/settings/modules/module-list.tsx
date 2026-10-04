"use client";

import type { ModuleKey } from "@bookalyze/core";
import { Link2 } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { MODULE_ICONS } from "@/components/shell/module-icons";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { setModuleEnabledAction } from "./actions";

type Item = {
  key: ModuleKey;
  label: string;
  description: string;
  requires: string[];
  phase: string;
  comingSoon: boolean;
  allowed: boolean;
  enabled: boolean;
};

export function ModuleList({
  slug,
  items,
  canEdit,
  planName,
}: {
  slug: string;
  items: Item[];
  canEdit: boolean;
  planName: string;
}) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    items,
    (current, change: { key: string; enabled: boolean }) =>
      current.map((i) => (i.key === change.key ? { ...i, enabled: change.enabled } : i)),
  );

  return (
    <div className="grid gap-4">
      {!canEdit ? <Alert>Only owners and admins can change features.</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {optimistic.map((item) => {
          const Icon = MODULE_ICONS[item.key];
          return (
            <div
              key={item.key}
              className={cn(
                "flex gap-4 rounded-2xl border bg-card p-5 shadow-xs transition-all duration-300",
                item.enabled && "border-primary/25 shadow-md shadow-primary/5",
              )}
            >
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors duration-300",
                  item.enabled
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <label htmlFor={`module-${item.key}`} className="cursor-pointer font-medium">
                    {item.label}
                  </label>
                  <Switch
                    id={`module-${item.key}`}
                    checked={item.enabled}
                    disabled={!canEdit || !item.allowed}
                    aria-label={`${item.label}: ${item.enabled ? "on" : "off"}`}
                    onCheckedChange={(checked) => {
                      startTransition(async () => {
                        setOptimistic({ key: item.key, enabled: checked });
                        const result = await setModuleEnabledAction(slug, item.key, checked);
                        if (!result.ok) toast.error(result.message);
                        else
                          toast.success(
                            `${item.label} ${checked ? "switched on" : "switched off"}`,
                          );
                      });
                    }}
                  />
                </div>
                <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                  {item.description}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={item.enabled ? "success" : "secondary"}>
                    {item.enabled ? "On" : "Off"}
                  </Badge>
                  {item.comingSoon ? (
                    <Badge variant="outline">Screens arrive in phase {item.phase}</Badge>
                  ) : null}
                  {item.requires.length ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                      <Link2 className="size-3" />
                      Needs {item.requires.join(" and ")}
                    </span>
                  ) : null}
                  {!item.allowed ? <Badge variant="warning">Not in {planName}</Badge> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
