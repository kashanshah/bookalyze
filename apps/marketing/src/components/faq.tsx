import { ChevronDown } from "lucide-react";

export type Question = { q: string; a: React.ReactNode };

/** Questions that open in place. */
export function Faq({ items }: { items: readonly Question[] }) {
  return (
    <div className="mx-auto grid max-w-3xl divide-y rounded-2xl border bg-card shadow-xs">
      {items.map((item) => (
        <details key={item.q} className="group px-5 sm:px-6">
          <summary className="flex list-none items-center justify-between gap-4 py-5 font-medium">
            {item.q}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="-mt-1 pb-5 text-muted-foreground text-sm leading-6">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
