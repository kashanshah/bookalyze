import { cn } from "@/lib/utils";

/** Two-column settings section: explanation on the left, controls on the right. */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  className?: string;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "grid gap-6 py-8 first:pt-0 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-10",
        className,
      )}
    >
      <div>
        <h2 className="font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
