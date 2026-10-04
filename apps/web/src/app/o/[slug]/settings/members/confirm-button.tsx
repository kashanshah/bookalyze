"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** A small destructive button that asks for a second click before acting. */
export function ConfirmButton({
  action,
  children,
  confirmLabel,
  toastMessage,
}: {
  action: () => Promise<void>;
  children: React.ReactNode;
  confirmLabel: string;
  toastMessage: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      type="button"
      size="sm"
      variant={armed ? "destructive" : "ghost"}
      disabled={pending}
      onClick={() => {
        if (!armed) return setArmed(true);
        startTransition(async () => {
          await action();
          toast.success(toastMessage);
        });
      }}
    >
      {pending ? <Spinner /> : null}
      {armed ? confirmLabel : children}
    </Button>
  );
}
