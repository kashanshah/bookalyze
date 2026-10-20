import { cn } from "@/lib/site";

/** A page section: the usual width and spacing, optionally on the tinted background. */
export function Section({
  id,
  tint,
  className,
  children,
}: {
  id?: string;
  tint?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("py-20 sm:py-28", tint && "border-y bg-sidebar")}>
      <div className={cn("mx-auto max-w-6xl px-4 sm:px-6", className)}>{children}</div>
    </section>
  );
}

/** A section's small label, title and lead. */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "center",
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "center" | "start";
  as?: "h1" | "h2";
}) {
  return (
    <div className={cn("grid max-w-2xl gap-4", align === "center" && "mx-auto text-center")}>
      {eyebrow ? <p className="font-medium text-primary text-sm">{eyebrow}</p> : null}
      <Tag
        className={cn(
          "text-balance font-semibold tracking-tight",
          Tag === "h1" ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl",
        )}
      >
        {title}
      </Tag>
      {lead ? (
        <p className="text-pretty text-lg text-muted-foreground leading-relaxed">{lead}</p>
      ) : null}
    </div>
  );
}

/** A list of short points, each with a tick. */
export function Checklist({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={cn("grid gap-2.5 text-sm leading-6", className)}>
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="mt-1 size-4 shrink-0 fill-none stroke-2 stroke-success"
          >
            <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
