"use client";

import type { CompareMode } from "@bookalyze/core";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { useNavigate } from "../report-controls";

/** Adds comparison columns: the period just before, or the same dates a year earlier. */
export function ComparePicker({
  value,
  previous,
  lastYear,
}: {
  value: CompareMode;
  /** The dates each choice compares with, shown under its name. */
  previous: string;
  lastYear: string;
}) {
  const { go } = useNavigate();
  return (
    <div className="grid gap-2 print:hidden">
      <Label htmlFor="compare">Compare with</Label>
      <Combobox
        id="compare"
        value={value}
        onChange={(mode) => go({ compare: mode === "none" ? null : mode })}
        searchable={false}
        wrapperClassName="w-full sm:w-72"
        options={[
          { value: "none", label: "No comparison" },
          { value: "previous", label: "Previous period", description: previous },
          { value: "last-year", label: "Same period last year", description: lastYear },
        ]}
      />
    </div>
  );
}
