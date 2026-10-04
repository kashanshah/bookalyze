"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AcceptInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <div className="grid gap-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const { error } = await authClient.organization.acceptInvitation({ invitationId });
          setPending(false);
          if (error) {
            setError(error.message ?? "Could not accept the invitation.");
            return;
          }
          router.push("/");
          router.refresh();
        }}
      >
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
