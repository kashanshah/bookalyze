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
  uploads = false,
}: {
  slug: string;
  connectionId: string;
  name: string;
  canDisconnect: boolean;
  /** Statement uploads: nothing to sync, and nothing secret to delete. */
  uploads?: boolean;
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
      toast.success(uploads ? "Removed" : "Disconnected", {
        description: uploads
          ? "Transactions already brought in stay in your books."
          : "The token was deleted. Transactions already brought in stay in your books.",
      });
    });

  return (
    <div className="flex flex-wrap gap-2">
      {uploads ? null : (
        <Button type="button" variant="outline" onClick={sync} disabled={syncing}>
          {syncing ? <Spinner /> : <RefreshCw />}
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      )}
      {canDisconnect ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost">
              <Unplug />
              {uploads ? "Remove" : "Disconnect"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {uploads ? `Remove statement uploads for ${name}?` : `Disconnect ${name}?`}
              </DialogTitle>
              <DialogDescription>
                {uploads
                  ? "It disappears from this page. Transactions already brought in stay in your books, and uploading again later won't duplicate them."
                  : "Bookalyze deletes the saved API token and stops syncing. Transactions already brought in stay in your books, and you can connect again at any time without getting duplicates."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep it
              </Button>
              <Button type="button" variant="destructive" onClick={disconnect} disabled={removing}>
                {removing ? <Spinner /> : null}
                {uploads ? "Remove" : "Disconnect"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
