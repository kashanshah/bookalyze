"use client";

import { Send } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { type InviteState, inviteMemberAction } from "./actions";

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(
    inviteMemberAction.bind(null, slug),
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.invited) {
      toast.success(`Invitation sent to ${state.invited}`);
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);
  return (
    <form ref={formRef} action={action} className="rounded-2xl border bg-card p-5 shadow-xs">
      <h2 className="font-semibold">Invite someone</h2>
      <p className="mt-0.5 text-muted-foreground text-sm">
        They'll get an email with a link to join. Invitations expire after 7 days.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="invite-email">Email address</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="accountant@firm.com"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="invite-role">Access level</Label>
          <NativeSelect id="invite-role" name="role" defaultValue="member">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </NativeSelect>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Send />}
          Send invite
        </Button>
      </div>
      {state.error ? <p className="mt-2 text-destructive text-xs">{state.error}</p> : null}
    </form>
  );
}
