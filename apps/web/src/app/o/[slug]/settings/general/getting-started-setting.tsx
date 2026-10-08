"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/shell/settings-section";
import { Switch } from "@/components/ui/switch";
import { setGettingStartedHiddenAction } from "./actions";

/** Whether the home page shows the setup checklist. */
export function GettingStartedSetting({
  slug,
  hidden,
  canEdit,
}: {
  slug: string;
  hidden: boolean;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <SettingsSection
      className="border-t"
      title="Home page"
      description="The setup checklist on the home page. Hide it once this company is up and running."
    >
      <div className="flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
        <label htmlFor="show-getting-started" className="min-w-0 cursor-pointer">
          <span className="block font-medium text-sm">Show "Get started with Bookalyze"</span>
          <span className="mt-0.5 block text-muted-foreground text-sm">
            Company details, features, and the first connections.
          </span>
        </label>
        <Switch
          id="show-getting-started"
          checked={!hidden}
          disabled={!canEdit || pending}
          onCheckedChange={(shown) =>
            startTransition(async () => {
              const result = await setGettingStartedHiddenAction(slug, !shown);
              if (result.ok) {
                toast.success(
                  shown ? "Setup steps will show on the home page" : "Setup steps hidden",
                );
              } else toast.error(result.message);
            })
          }
        />
      </div>
    </SettingsSection>
  );
}
