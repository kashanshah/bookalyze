"use client";

import { parseDecimal } from "@bookalyze/core";
import { useState } from "react";

export type TrendPoint = {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** The figure for that day, already formatted ("12 orders", "AED 40.00"). */
  text: string;
  value?: number;
  amount?: string;
};

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

function dayLabel(date: string, locale: string, withYear: boolean) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * A quiet area chart. Pointing at a day shows that day's figure and a marker on the line.
 */
export function TrendChart({
  points,
  label,
  locale,
}: {
  points: readonly TrendPoint[];
  label: string;
  locale: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const heights =
    points[0]?.amount !== undefined
      ? heightsFromAmounts(points.map((point) => point.amount ?? "0"))
      : heightsFromCounts(points.map((point) => point.value ?? 0));
  const width = 320;
  const height = 72;
  const top = 6;
  const geometry = heights.map((share, index) => {
    const x = heights.length <= 1 ? width / 2 : (index / (heights.length - 1)) * width;
    const y = height - top - share * (height - top * 2);
    return { x, y };
  });
  const line = geometry
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const current = active === null ? null : geometry[active];
  const currentPoint = active === null ? null : points[active];
  const withYear = points[0]?.date.slice(0, 4) !== points.at(-1)?.date.slice(0, 4);
  const step = points.length <= 1 ? width : width / (points.length - 1);
  const bandX = current ? Math.max(0, Math.min(width - step, current.x - step / 2)) : 0;

  const focusDay = (clientX: number, bounds: DOMRect) => {
    if (points.length === 0 || bounds.width === 0) return;
    const ratio = (clientX - bounds.left) / bounds.width;
    const index = Math.round(ratio * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, index)));
  };

  return (
    <div className="mt-3">
      <p className="flex h-5 items-baseline gap-2 text-xs">
        {currentPoint ? (
          <>
            <span className="text-muted-foreground">
              {dayLabel(currentPoint.date, locale, withYear)}
            </span>
            <span className="tabular font-medium">{currentPoint.text}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Point at a day</span>
        )}
      </p>
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-16 w-full cursor-crosshair touch-pan-y"
          role="img"
          aria-label={
            currentPoint
              ? `${dayLabel(currentPoint.date, locale, true)}, ${currentPoint.text}`
              : label
          }
          onPointerMove={(event) =>
            focusDay(event.clientX, event.currentTarget.getBoundingClientRect())
          }
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setActive(null);
          }}
        >
          <path d={area} className="fill-primary/15" />
          {current ? (
            <rect x={bandX} y={0} width={step} height={height} className="fill-primary/10" />
          ) : null}
          <path
            d={line}
            className="fill-none stroke-primary"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {current ? (
            <line
              x1={current.x}
              x2={current.x}
              y1={0}
              y2={height}
              className="stroke-primary/50"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        {current ? (
          <span
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-card"
            style={{
              left: `${(current.x / width) * 100}%`,
              top: `${(current.y / height) * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
