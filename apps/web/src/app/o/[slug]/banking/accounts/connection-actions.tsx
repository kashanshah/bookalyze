"use client";

import { RefreshCw, Unplug } from "lucide-react";
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
import { disconnectAction, syncConnectionAction } from "../actions";
import { summaryMessage } from "./summary";

export function ConnectionActions({
  slug,
  connectionId,
  name,
  canDisconnect,
}: {
  slug: string;
  connectionId: string;
  name: string;
  canDisconnect: boolean;
}) {
  const [syncing, startSync] = useTransition();
  const [removing, startRemove] = useTransition();
  const [open, setOpen] = useState(false);

  const sync = () =>
    startSync(async () => {
      const result = await syncConnectionAction(slug, connectionId);
      if (!result.ok) return void toast.error(result.message);
      const { title, description, tone } = summaryMessage(result.summary);
      (tone === "error" ? toast.error : toast.success)(title, { description });
    });

  const disconnect = () =>
    startRemove(async () => {
      const result = await disconnectAction(slug, connectionId);
      if (!result.ok) return void toast.error(result.message);
      setOpen(false);
      toast.success("Disconnected", {
        description: "The token was deleted. Transactions already brought in stay in your books.",
      });
    });

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={sync} disabled={syncing}>
        {syncing ? <Spinner /> : <RefreshCw />}
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
      {canDisconnect ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost">
              <Unplug />
              Disconnect
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disconnect {name}?</DialogTitle>
              <DialogDescription>
                Bookalyze deletes the saved API token and stops syncing. Transactions already
                brought in stay in your books, and you can connect again at any time without getting
                duplicates.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep it
              </Button>
              <Button type="button" variant="destructive" onClick={disconnect} disabled={removing}>
                {removing ? <Spinner /> : null}
                Disconnect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
