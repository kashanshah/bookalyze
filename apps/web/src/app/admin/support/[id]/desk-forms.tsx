"use client";

import { SUPPORT_DESK_STATUS_LABELS, SUPPORT_PRIORITY_LABELS } from "@bookalyze/core";
import { Send, StickyNote, UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deskReplyAction, deskUpdateAction } from "../actions";

export function DeskReply({
  ticketId,
  customerHasAccount,
}: {
  ticketId: string;
  customerHasAccount: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await deskReplyAction({ ticketId, message, internal });
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          setMessage("");
          toast.success(internal ? "Note added" : "Reply sent");
          router.refresh();
        });
      }}
    >
      <Field
        label={internal ? "Internal note" : "Reply"}
        htmlFor="desk-reply"
        hint={
          internal
            ? "Only the support desk sees notes. Nothing is emailed."
            : customerHasAccount
              ? "Emailed to the customer and shown on their ticket in the app."
              : "Emailed to the customer. They answer by replying to the email."
        }
      >
        <Textarea
          id="desk-reply"
          rows={5}
          value={message}
          maxLength={10000}
          onChange={(e) => setMessage(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm" htmlFor="desk-internal">
          <Switch id="desk-internal" checked={internal} onCheckedChange={setInternal} />
          Internal note
        </label>
        <Button type="submit" disabled={pending || !message.trim()}>
          {pending ? <Spinner /> : internal ? <StickyNote /> : <Send />}
          {internal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}

const STATUS_OPTIONS = Object.entries(SUPPORT_DESK_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const PRIORITY_OPTIONS = Object.entries(SUPPORT_PRIORITY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function DeskControls({
  ticketId,
  status,
  priority,
  mine,
  assigned,
}: {
  ticketId: string;
  status: string;
  priority: string;
  mine: boolean;
  assigned: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (change: Record<string, unknown>, done: string) =>
    start(async () => {
      const result = await deskUpdateAction({ ticketId, ...change });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(done);
      router.refresh();
    });
  return (
    <div className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs">
      <Field label="Status" htmlFor="desk-status">
        <Combobox
          id="desk-status"
          value={status}
          options={STATUS_OPTIONS}
          disabled={pending}
          onChange={(value) => save({ status: value }, "Status changed")}
        />
      </Field>
      <Field label="Priority" htmlFor="desk-priority">
        <Combobox
          id="desk-priority"
          value={priority}
          options={PRIORITY_OPTIONS}
          disabled={pending}
          onChange={(value) => save({ priority: value }, "Priority changed")}
        />
      </Field>
      {mine ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => save({ unassign: true }, "Unassigned")}
        >
          <UserX />
          Unassign me
        </Button>
      ) : (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => save({ assignToMe: true }, "Assigned to you")}
        >
          <UserCheck />
          {assigned ? "Take it over" : "Assign to me"}
        </Button>
      )}
    </div>
  );
}
