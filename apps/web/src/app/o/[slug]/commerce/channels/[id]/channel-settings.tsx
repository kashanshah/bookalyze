"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { setChannelActiveAction } from "../../actions";

/** Switches a channel on or off; switched-off channels keep their history. */
export function ChannelSwitch({
  slug,
  channel,
  label,
  hint,
  canManage,
}: {
  slug: string;
  channel: { id: string; isActive: boolean };
  label: string;
  hint: string;
  canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const id = `channel-${channel.id}`;
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="font-medium text-sm">
          {label}
        </label>
        <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
      </div>
      {pending ? <Spinner className="mt-0.5 text-muted-foreground" /> : null}
      <Switch
        id={id}
        checked={channel.isActive}
        disabled={!canManage || pending}
        aria-label={label}
        onCheckedChange={(on) =>
          start(async () => {
            const result = await setChannelActiveAction(slug, channel.id, on);
            if (!result.ok) return void toast.error(result.message);
            toast.success(on ? "Switched on" : "Switched off", {
              description: on ? undefined : "It keeps its history.",
            });
          })
        }
      />
    </div>
  );
}
