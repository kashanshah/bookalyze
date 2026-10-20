"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { removeChannelAction, setChannelActiveAction } from "../../actions";

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

/**
 * Removing a Noon country or eBay site added by mistake, with what was brought in for it. While
 * something of it is in the books (`blocked`), the button stays off and says what to take out.
 */
export function RemoveChannel({
  slug,
  channel,
  blocked,
}: {
  slug: string;
  channel: { id: string; name: string; kind: "noon" | "ebay" };
  /** Why it can't go yet ("2 posted Noon months"), or null when it can. */
  blocked: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const brought = channel.kind === "noon" ? "Noon transactions" : "eBay transactions and payouts";
  const remove = () =>
    start(async () => {
      const result = await removeChannelAction(slug, channel.id);
      if (!result.ok) return void toast.error(result.message);
      toast.success(`${result.name} removed`, {
        description: "Nothing brought in for it counts anywhere now.",
      });
      setOpen(false);
      router.push(`/o/${slug}/commerce/channels`);
    });
  return (
    <div className="flex flex-wrap items-start gap-3 border-t pt-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">Remove {channel.name}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {blocked
            ? `It still has ${blocked} in your books. Take ${blocked.includes(" and ") ? "them" : "it"} out first, then it can be removed.`
            : `For a channel added by mistake: its orders and ${brought} go with it, and stop counting in Channel profit and stock. To stop selling there, switch it off instead.`}
        </p>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" disabled={Boolean(blocked)}>
            <Trash2 />
            Remove channel
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {channel.name}?</DialogTitle>
            <DialogDescription>
              Its orders, {brought}, stock movements and SKU links are deleted, and it leaves
              Channel profit. Your books don't change: nothing of it is in them. This can't be
              undone, but you can add the channel again and bring its data back in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {pending ? <Spinner /> : <Trash2 />}
              Remove channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
