import { Info, MapPin, TriangleAlert } from "lucide-react";
import type { Block } from "@/content/guides";
import { cn } from "@/lib/site";

/** Text with **bold** marks. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** One guide block: a paragraph, where in the app, steps, a list, checks, a note or a table. */
export function GuideBlock({ block }: { block: Block }) {
  if ("p" in block) {
    return (
      <p className="text-muted-foreground leading-7">
        <Rich text={block.p} />
      </p>
    );
  }
  if ("where" in block) {
    return (
      <p className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-3 py-1.5 font-medium text-accent-foreground text-sm">
        <MapPin className="size-3.5 shrink-0" />
        <span>
          <span className="sr-only">Where in the app: </span>
          {block.where}
        </span>
      </p>
    );
  }
  if ("steps" in block) {
    return (
      <ol className="grid gap-4">
        {block.steps.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
              {i + 1}
            </span>
            <div className="grid gap-1">
              <p className="font-medium">
                <Rich text={step.title} />
              </p>
              <p className="text-muted-foreground text-sm leading-6">
                <Rich text={step.body} />
              </p>
            </div>
          </li>
        ))}
      </ol>
    );
  }
  if ("list" in block) {
    return (
      <ul className="grid list-disc gap-2 ps-5 text-muted-foreground leading-7 marker:text-primary/60">
        {block.list.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if ("check" in block) {
    return (
      <div className="grid gap-3 rounded-2xl border border-success/30 bg-success/6 p-5">
        <p className="font-semibold text-sm">What you should see</p>
        <ul className="grid gap-2.5 text-sm leading-6">
          {block.check.map((item) => (
            <li key={item} className="flex gap-2.5">
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="mt-1 size-4 shrink-0 fill-none stroke-2 stroke-success"
              >
                <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>
                <Rich text={item} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if ("note" in block) {
    const caution = block.tone === "caution";
    const Icon = caution ? TriangleAlert : Info;
    return (
      <div
        className={cn(
          "flex gap-3 rounded-xl border p-4 text-sm leading-6",
          caution ? "border-warning/40 bg-warning/10" : "border-primary/20 bg-accent/60",
        )}
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", caution ? "text-warning" : "text-primary")} />
        <p>
          <span className="sr-only">{caution ? "Caution: " : "Tip: "}</span>
          <Rich text={block.note} />
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-start text-sm">
        <thead className="bg-muted/50">
          <tr>
            {block.table.head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {block.table.rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, i) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells of one fixed row
                  key={i}
                  className={cn(
                    "px-4 py-2.5 align-top leading-6",
                    i > 0 && "text-muted-foreground",
                  )}
                >
                  <Rich text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Headings become anchors: "What you'll need" → "what-youll-need". */
export function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
