"use client";

import { PASSWORD_RULES, passwordProblems } from "@bookalyze/core";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The password rules under a new-password field, each ticked as it's met (core
 * `passwordProblems`). The server checks them again, and also against known data breaches.
 */
export function PasswordRules({
  password,
  email,
  name,
  id,
}: {
  password: string;
  email?: string | null;
  name?: string | null;
  id?: string;
}) {
  const problems = passwordProblems(password, { email, name });
  return (
    // Spans, not a list: Field puts its hint inside a paragraph.
    <span id={id} className="grid gap-0.5" aria-live="polite">
      {PASSWORD_RULES.map(({ rule, label }) => {
        const met = password.length > 0 && !problems.includes(rule);
        return (
          <span
            key={rule}
            className={cn(
              "inline-flex items-center gap-1 transition-colors",
              met && "text-success",
            )}
          >
            <Check
              className={cn(
                "size-3 shrink-0 transition-opacity",
                met ? "opacity-100" : "opacity-40",
              )}
              aria-hidden="true"
            />
            {label}
            <span className="sr-only">{met ? " (done)" : " (not yet)"}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Whether the form may be sent: every rule met, as far as the browser can tell. */
export function passwordReady(
  password: string,
  context: { email?: string | null; name?: string | null } = {},
) {
  return passwordProblems(password, context).length === 0;
}
