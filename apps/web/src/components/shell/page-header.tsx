export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 font-medium text-muted-foreground text-sm">{eyebrow}</p>
        ) : null}
        <h1 className="font-semibold text-[26px] leading-tight tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
