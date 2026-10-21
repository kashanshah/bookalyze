"use client";

import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";

type EmbeddedCheckoutInstance = { mount(element: HTMLElement): void; destroy(): void };
type StripeFactory = (publishableKey: string) => {
  initEmbeddedCheckout(options: {
    fetchClientSecret: () => Promise<string>;
  }): Promise<EmbeddedCheckoutInstance>;
};

declare global {
  interface Window {
    Stripe?: StripeFactory;
  }
}

/** Stripe.js matching the API version the session is created with (server/stripe.ts). */
const STRIPE_JS = "https://js.stripe.com/basil/stripe.js";

let stripeJs: Promise<StripeFactory> | null = null;

/** Stripe.js must come from js.stripe.com (PCI), so it's loaded here, once, not bundled. */
function loadStripe(): Promise<StripeFactory> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  stripeJs ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = STRIPE_JS;
    script.async = true;
    script.onload = () =>
      window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js didn't start"));
    script.onerror = () => {
      stripeJs = null;
      script.remove();
      reject(new Error("Stripe.js didn't load"));
    };
    document.head.append(script);
  });
  return stripeJs;
}

// Stripe allows one embedded form on a page at a time: each waits for the one before to go.
let queue: Promise<unknown> = Promise.resolve();

/** Stripe's card form, on our page, for a Checkout Session's client secret. */
export function EmbeddedCheckout({
  publishableKey,
  clientSecret,
}: {
  publishableKey: string;
  clientSecret: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let gone = false;
    let checkout: EmbeddedCheckoutInstance | null = null;
    setState("loading");
    queue = queue.then(async () => {
      try {
        const Stripe = await loadStripe();
        if (gone) return;
        const instance = await Stripe(publishableKey).initEmbeddedCheckout({
          fetchClientSecret: async () => clientSecret,
        });
        if (gone || !ref.current) {
          instance.destroy();
          return;
        }
        checkout = instance;
        instance.mount(ref.current);
        setState("ready");
      } catch {
        if (!gone) setState("failed");
      }
    });
    return () => {
      gone = true;
      checkout?.destroy();
    };
  }, [publishableKey, clientSecret]);

  return (
    <div className="grid gap-3">
      {state === "loading" ? (
        <p className="flex items-center gap-2.5 text-muted-foreground text-sm">
          <Spinner />
          Opening the secure card form…
        </p>
      ) : null}
      {state === "failed" ? (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          The card form didn't load. Check your connection, or allow js.stripe.com if something
          blocks it, then choose the plan again.
        </p>
      ) : null}
      <div
        ref={ref}
        className="fade-in-0 min-h-0 animate-in overflow-hidden rounded-xl duration-300"
      />
    </div>
  );
}
