import type { DailyRow } from "@bookalyze/db";

const count = new Intl.NumberFormat("en-CA");
const dayLabel = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const label = (day: string) => dayLabel.format(new Date(`${day}T00:00:00Z`));

/**
 * One measure, day by day, as thin bars on a shared baseline. Hovering or focusing a bar shows its
 * day and value; the same numbers are in a table below for screen readers and for copying.
 */
export function DailyChart({
  title,
  hint,
  rows,
  value,
  unit,
}: {
  title: string;
  hint: string;
  rows: DailyRow[];
  value: (row: DailyRow) => number;
  unit: string;
}) {
  const values = rows.map(value);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const first = rows[0];
  const last = rows.at(-1);

  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{hint}</p>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          Busiest day{" "}
          <span className="font-medium text-foreground">{count.format(total ? max : 0)}</span>
        </p>
      </div>

      <div className="grid gap-1.5">
        <div className="flex h-32 items-end gap-[2px] border-b" aria-hidden="true">
          {rows.map((row) => {
            const v = value(row);
            return (
              <div key={row.day} className="group relative flex h-full flex-1 items-end">
                <div
                  className="w-full rounded-t-[4px] bg-primary transition-colors group-hover:bg-primary/80"
                  style={{ height: v ? `${Math.max(4, (v / max) * 100)}%` : "0" }}
                />
                <div className="pointer-events-none absolute start-1/2 bottom-full z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-md group-hover:block rtl:translate-x-1/2">
                  <span className="text-muted-foreground">{label(row.day)}</span>{" "}
                  <span className="font-medium tabular-nums">
                    {count.format(v)} {unit}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {first && last ? (
          <div className="flex justify-between text-muted-foreground text-xs" aria-hidden="true">
            <span>{label(first.day)}</span>
            <span>{label(last.day)}</span>
          </div>
        ) : null}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Show as a table
        </summary>
        <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {title}, by day ({unit})
            </caption>
            <thead className="sticky top-0 border-b bg-card text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Day (UTC)</th>
                <th className="px-3 py-2 text-end font-medium">{unit}</th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {[...rows].reverse().map((row) => (
                <tr key={row.day}>
                  <td className="px-3 py-1.5">{label(row.day)}</td>
                  <td className="px-3 py-1.5 text-end">{count.format(value(row))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
