"use client";

import { Check, Inbox, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { sendInvoiceToAmazonAction, setInvoiceRequestStatusAction } from "./invoice-actions";

/** Sends the saved invoice through Amazon, after a confirm step (it reaches the buyer). */
export function SendToAmazonButton({
  slug,
  orderId,
  number,
  sent,
}: {
  slug: string;
  orderId: string;
  number: string;
  sent: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const result = await sendInvoiceToAmazonAction(slug, orderId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setConfirming(false);
      toast.success(`${result.number} sent to the buyer through Amazon`);
      router.refresh();
    });

  if (!confirming) {
    return (
      <Button size="sm" variant={sent ? "outline" : "default"} onClick={() => setConfirming(true)}>
        <Send />
        {sent ? "Send again" : "Send to Amazon"}
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
      <p className="min-w-0 flex-1 text-sm">
        Send {number} to the buyer with Amazon's invoice message?
      </p>
      <Button size="sm" onClick={send} disabled={pending}>
        {pending ? <Spinner /> : <Send />}
        {pending ? "Sending…" : "Send"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
    </div>
  );
}

/** The buyer's open request, with a way to close it when it was answered elsewhere. */
export function InvoiceRequestNotice({
  slug,
  requestId,
  text,
}: {
  slug: string;
  requestId: string;
  text: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (status: "done" | "dismissed") =>
    start(async () => {
      const result = await setInvoiceRequestStatusAction(slug, requestId, status);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(status === "done" ? "Marked as answered" : "Request set aside");
      router.refresh();
    });
  return (
    <div className="mt-3 flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5">
      <Inbox className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-sm">{text}</p>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => set("done")} disabled={pending}>
          {pending ? <Spinner /> : <Check />}
          Answered
        </Button>
        <Button size="sm" variant="ghost" onClick={() => set("dismissed")} disabled={pending}>
          <X />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
