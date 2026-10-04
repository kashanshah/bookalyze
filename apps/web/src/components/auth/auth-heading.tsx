export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
      {description ? (
        <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}
