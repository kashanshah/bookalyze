"use client";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { useNavigate } from "../report-controls";

/** Switches between every account's summary and one account's lines, keeping the period. */
export function AccountPicker({ value, options }: { value: string; options: ComboboxOption[] }) {
  const { go } = useNavigate();
  return (
    <div className="grid gap-2 print:hidden">
      <Label htmlFor="ledger-account">Account</Label>
      <Combobox
        id="ledger-account"
        value={value}
        onChange={(id) => go({ account: id || null })}
        options={[{ value: "", label: "All accounts" }, ...options]}
        searchPlaceholder="Search accounts"
        wrapperClassName="w-full sm:w-80"
      />
    </div>
  );
}
