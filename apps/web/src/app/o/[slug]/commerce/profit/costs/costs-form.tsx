"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Spinner } from "@/components/ui/spinner";
import { saveChannelCostsAction } from "../actions";

type Category = { accountId: string; label: string; channel: string };

/** Each expense category with the channel it counts against ("" not counted, "shared"). */
export function CostsForm({
  slug,
  categories,
  channels,
  canManage,
}: {
  slug: string;
  categories: Category[];
  channels: ComboboxOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((c) => [c.accountId, c.channel])),
  );
  const options: ComboboxOption[] = [
    { value: "", label: "Not counted", description: "Not a cost of selling" },
    {
      value: "shared",
      label: "Shared",
      description: "Under All channels only, not split",
    },
    ...channels,
  ];
  const counted = Object.values(chosen).filter(Boolean).length;

  if (!categories.length) {
    return (
      <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground text-sm">
        No expense categories yet. Add one on the chart of accounts, then choose its channel here.
      </p>
    );
  }

  const save = () =>
    start(async () => {
      const result = await saveChannelCostsAction(slug, {
        choices: Object.entries(chosen)
          .filter(([, channel]) => channel)
          .map(([accountId, channel]) => ({ accountId, channel })),
      });
      if (!result.ok) return void toast.error(result.message);
      toast.success("Channel profit counts these costs", {
        description: counted
          ? `${counted} ${counted === 1 ? "category" : "categories"} counted.`
          : "No categories counted.",
      });
      router.push(`/o/${slug}/commerce/profit`);
    });

  return (
    <div className="grid gap-4">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <ul className="divide-y">
          {categories.map((c, i) => (
            <li
              key={c.accountId}
              className="fade-in-0 grid animate-in items-center gap-2 fill-mode-both px-4 py-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:gap-4 sm:px-5"
              style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
            >
              <span id={`cost-${c.accountId}`} className="min-w-0 truncate font-medium text-sm">
                {c.label}
              </span>
              <Combobox
                aria-labelledby={`cost-${c.accountId}`}
                value={chosen[c.accountId] ?? ""}
                onChange={(v) => setChosen((all) => ({ ...all, [c.accountId]: v }))}
                options={options}
                disabled={!canManage || pending}
              />
            </li>
          ))}
        </ul>
      </div>
      <p className="text-muted-foreground text-xs">
        Cost of goods sold is counted on its own, from the months you post. Entries from Amazon's
        settlements and Noon's and eBay's months aren't counted again, even in a category chosen
        here.
      </p>
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? <Spinner /> : <Check />}
            Save
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Only owners and admins can change these.</p>
      )}
    </div>
  );
}
