"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";

/** Back from Checkout: checks again every two seconds until Stripe's confirmation opens the company. */
export function WaitForStripe() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p className="fade-in-0 flex animate-in items-center gap-2.5 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm">
      <Spinner />
      Thanks. Stripe is confirming your card; your company opens in a few seconds.
    </p>
  );
}
