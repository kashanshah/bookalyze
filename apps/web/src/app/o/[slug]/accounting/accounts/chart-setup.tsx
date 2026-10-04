"use client";

import { BookOpenCheck, Check } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setupChartAction } from "../actions";

const HIGHLIGHTS = [
  "Cash, receivables, inventory and equipment",
  "Payables, owner loans and retained earnings",
  "Sales, cost of goods sold and everyday expenses",
];

/** Empty state for companies created before accounting existed. */
export function ChartSetup({ slug, companyName }: { slug: string; companyName: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-12 shadow-xs sm:px-10">
      <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
      <div className="relative mx-auto flex max-w-lg flex-col items-center gap-5 text-center">
        <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
          <BookOpenCheck className="size-7" />
        </span>
        <div>
          <h2 className="font-semibold text-lg tracking-tight">Set up your chart of accounts</h2>
          <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
            Accounts are the categories every transaction is sorted into. Start {companyName} with a
            standard set that works in any country. You can rename, add or archive accounts any
            time.
          </p>
        </div>
        <ul className="grid gap-2 text-start text-sm">
          {HIGHLIGHTS.map((h) => (
            <li key={h} className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-success" />
              {h}
            </li>
          ))}
        </ul>
        <Button
          size="lg"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setupChartAction(slug);
              if (result.ok) toast.success(`Added ${result.data.created} accounts`);
              else toast.error(result.message ?? "Could not set up the chart of accounts");
            })
          }
        >
          {pending ? <Spinner /> : null}
          Use the standard chart of accounts
        </Button>
      </div>
    </div>
  );
}
