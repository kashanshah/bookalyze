"use client";

import { Printer } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { DatePreset, RangePreset } from "./periods";

function useNavigate() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return {
    pending,
    go: (params: Record<string, string>) =>
      startTransition(() =>
        router.replace(`${pathname}?${new URLSearchParams(params)}`, { scroll: false }),
      ),
  };
}

function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="print:hidden">
      <Printer />
      Print
    </Button>
  );
}

/** Period picker for reports that cover a date range (profit and loss). */
export function RangeControls({
  from,
  to,
  presets,
}: {
  from: string;
  to: string;
  presets: RangePreset[];
}) {
  const { pending, go } = useNavigate();
  const current = presets.find((p) => p.from === from && p.to === to)?.key ?? "custom";
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="grid gap-2">
        <Label htmlFor="period">Period</Label>
        <Combobox
          id="period"
          value={current}
          onChange={(key) => {
            const preset = presets.find((p) => p.key === key);
            if (preset) go({ from: preset.from, to: preset.to });
          }}
          wrapperClassName="min-w-56"
          searchable={false}
          options={[
            ...presets.map((p) => ({ value: p.key, label: p.label })),
            { value: "custom", label: "Custom dates", disabled: true },
          ]}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="from">From</Label>
        <Input
          id="from"
          type="date"
          value={from}
          onChange={(e) => e.target.value && go({ from: e.target.value, to })}
          className="w-40"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="to">To</Label>
        <Input
          id="to"
          type="date"
          value={to}
          onChange={(e) => e.target.value && go({ from, to: e.target.value })}
          className="w-40"
        />
      </div>
      <div className="flex h-10 items-center gap-2">
        {pending ? <Spinner className="text-muted-foreground" /> : null}
      </div>
      <div className="ms-auto">
        <PrintButton />
      </div>
    </div>
  );
}

/** Date picker for point-in-time reports (balance sheet, trial balance). */
export function DateControls({ date, presets }: { date: string; presets: DatePreset[] }) {
  const { pending, go } = useNavigate();
  const current = presets.find((p) => p.date === date)?.key ?? "custom";
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="grid gap-2">
        <Label htmlFor="as-of-preset">As of</Label>
        <Combobox
          id="as-of-preset"
          value={current}
          onChange={(key) => {
            const preset = presets.find((p) => p.key === key);
            if (preset) go({ date: preset.date });
          }}
          wrapperClassName="min-w-48"
          searchable={false}
          options={[
            ...presets.map((p) => ({ value: p.key, label: p.label })),
            { value: "custom", label: "Custom date", disabled: true },
          ]}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="as-of">Date</Label>
        <Input
          id="as-of"
          type="date"
          value={date}
          onChange={(e) => e.target.value && go({ date: e.target.value })}
          className="w-40"
        />
      </div>
      <div className="flex h-10 items-center">
        {pending ? <Spinner className="text-muted-foreground" /> : null}
      </div>
      <div className="ms-auto">
        <PrintButton />
      </div>
    </div>
  );
}
