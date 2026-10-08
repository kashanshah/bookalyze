import { parseDecimal } from "@bookalyze/core";

/** Turns amounts into bar heights without using the amounts as floating-point money. */
function heightsFromAmounts(amounts: readonly string[]): number[] {
  const units = amounts.map((amount) => parseDecimal(amount));
  const max = units.reduce((highest, value) => (value > highest ? value : highest), 0n);
  if (max === 0n) return units.map(() => 0);
  return units.map((value) => Number((value * 1000n) / max) / 1000);
}

function heightsFromCounts(values: readonly number[]): number[] {
  const max = Math.max(...values, 0);
  if (max === 0) return values.map(() => 0);
  return values.map((value) => value / max);
}

/**
 * A quiet area chart for the home page. The numbers beside it are the figures; this only shows
 * the shape of the days.
 */
export function TrendChart({
  values,
  amounts,
  label,
}: {
  values?: readonly number[];
  amounts?: readonly string[];
  label: string;
}) {
  const heights = amounts ? heightsFromAmounts(amounts) : heightsFromCounts(values ?? []);
  const width = 320;
  const height = 72;
  const top = 4;
  const coords = heights.map((share, index) => {
    const x = heights.length <= 1 ? width / 2 : (index / (heights.length - 1)) * width;
    const y = height - top - share * (height - top * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-4 h-16 w-full"
      role="img"
      aria-label={label}
    >
      <path d={area} className="fill-primary/15" />
      <path
        d={line}
        className="fill-none stroke-primary"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
