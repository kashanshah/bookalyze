"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Choice = { value: string; label: string; description?: string; icon?: React.ReactNode };

/** Large, self-explanatory radio options rendered as selectable cards. */
export function ChoiceCards({
  name,
  value,
  onChange,
  choices,
  columns = 2,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  choices: Choice[];
  columns?: 2 | 3 | 4;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "grid gap-3",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
      )}
    >
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <label
            key={choice.value}
            className={cn(
              "group relative flex cursor-pointer gap-3 rounded-xl border bg-card p-4 text-start shadow-xs transition-all duration-150 hover:border-primary/40 hover:shadow-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
              selected && "border-primary bg-primary/[0.03] ring-1 ring-primary",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={selected}
              onChange={() => onChange(choice.value)}
              className="sr-only"
            />
            {choice.icon ? (
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors [&_svg]:size-[18px]",
                  selected && "bg-primary/10 text-primary",
                )}
              >
                {choice.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-sm">{choice.label}</span>
              {choice.description ? (
                <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">
                  {choice.description}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border transition-all duration-150",
                selected
                  ? "scale-100 border-primary bg-primary text-primary-foreground"
                  : "scale-90 opacity-60",
              )}
            >
              {selected ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
