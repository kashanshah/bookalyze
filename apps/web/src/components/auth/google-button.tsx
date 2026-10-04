"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3a7.2 7.2 0 0 1-10.73-3.78H1.33v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.34 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.33a12 12 0 0 0 0 10.8l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.6 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 1.33 6.6l4.01 3.1A7.17 7.17 0 0 1 12 4.77Z"
      />
    </svg>
  );
}

export function GoogleButton({ redirectTo, label }: { redirectTo: string; label: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signIn.social({
          provider: "google",
          callbackURL: redirectTo,
          newUserCallbackURL: redirectTo === "/" ? "/onboarding" : redirectTo,
          errorCallbackURL: "/sign-in",
        });
      }}
    >
      <GoogleIcon />
      {label}
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-muted-foreground text-xs uppercase tracking-wider">
      <span className="h-px flex-1 bg-border" />
      or with email
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
