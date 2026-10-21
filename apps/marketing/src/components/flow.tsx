// biome-ignore-all lint/a11y/noSvgWithoutTitle: the diagram is described by the figure's caption
import { cn } from "@/lib/site";

/*
 * The infographic: marketplaces flow into Bookalyze, which posts to the books, matches the bank
 * and works out profit. Two drawings of the same thing, wide for desktop and tall for phones.
 * The moving dots are SVG animations, left out with reduced motion.
 */

type Node = { x: number; y: number; w: number; h: number; title: string; sub: string };

function Box({ node, accent }: { node: Node; accent?: boolean }) {
  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={node.w}
        height={node.h}
        rx={14}
        className={cn("stroke-border", accent ? "fill-accent" : "fill-card")}
        strokeWidth={1}
      />
      <text
        x={node.x + node.w / 2}
        y={node.y + node.h / 2 - 3}
        textAnchor="middle"
        className="fill-foreground font-semibold text-[15px]"
      >
        {node.title}
      </text>
      <text
        x={node.x + node.w / 2}
        y={node.y + node.h / 2 + 15}
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
      >
        {node.sub}
      </text>
    </g>
  );
}

function Wire({ id, d, delay }: { id: string; d: string; delay: number }) {
  return (
    <g>
      <path id={id} d={d} fill="none" className="stroke-border" strokeWidth={2} />
      <path d={d} fill="none" className="anim-dash-flow stroke-primary/50" strokeWidth={2} />
      <g className="motion-reduce:hidden">
        {[0, 1].map((i) => (
          <circle key={i} r={4.5} className="fill-primary" opacity={0}>
            <animateMotion
              dur="2.6s"
              begin={`${delay + i * 1.3}s`}
              repeatCount="indefinite"
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.4 0 0.2 1"
            >
              <mpath href={`#${id}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.1;0.85;1"
              dur="2.6s"
              begin={`${delay + i * 1.3}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      </g>
    </g>
  );
}

function Hub({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 18} className="fill-primary/8" />
      <circle cx={cx} cy={cy} r={r + 8} className="fill-primary/12" />
      <circle cx={cx} cy={cy} r={r} className="fill-primary" />
      <image
        href="/brand/mark-white.svg"
        x={cx - r * 0.55}
        y={cy - r * 0.32}
        width={r * 1.1}
        height={r * 0.64}
      />
    </g>
  );
}

const SOURCES = [
  { title: "Amazon", sub: "Settlements, fees, refunds" },
  { title: "Walmart", sub: "Settlements, WFS stock" },
  { title: "Noon", sub: "Transactions, FBN stock" },
  { title: "eBay", sub: "Orders, fees, payouts" },
] as const;

const RESULTS = [
  { title: "Your books", short: "Books", sub: "One entry per payout" },
  { title: "Your bank", short: "Bank", sub: "Each deposit matched" },
  { title: "Your profit", short: "Profit", sub: "Per channel and product" },
] as const;

function Wide() {
  // Four sources on the left, three results on the right.
  const ins = [12, 104, 196, 288];
  const outs = [36, 158, 280];
  return (
    <svg viewBox="0 0 1000 380" className="hidden h-auto w-full md:block" aria-hidden="true">
      {ins.map((y, i) => (
        <Wire
          key={`in-${y}`}
          id={`flow-in-${i}`}
          d={`M232 ${y + 32} C 340 ${y + 32}, 350 190, 432 190`}
          delay={i * 0.3}
        />
      ))}
      {outs.map((y, i) => (
        <Wire
          key={`out-${y}`}
          id={`flow-out-${i}`}
          d={`M568 190 C 650 190, 660 ${y + 32}, 768 ${y + 32}`}
          delay={1.4 + i * 0.4}
        />
      ))}
      {SOURCES.map((s, i) => (
        <Box key={s.title} node={{ x: 32, y: ins[i] ?? 0, w: 200, h: 64, ...s }} />
      ))}
      <Hub cx={500} cy={190} r={62} />
      {RESULTS.map((s, i) => (
        <Box
          key={s.title}
          node={{ x: 768, y: outs[i] ?? 0, w: 200, h: 64, title: s.title, sub: s.sub }}
          accent
        />
      ))}
    </svg>
  );
}

function Tall() {
  // Four narrow sources along the top, three results along the bottom.
  const ins = [0, 92, 184, 276];
  const outs = [4, 124, 244];
  return (
    <svg viewBox="0 0 360 640" className="h-auto w-full md:hidden" aria-hidden="true">
      {ins.map((x, i) => (
        <Wire
          key={`in-${x}`}
          id={`flow-tin-${i}`}
          d={`M${x + 42} 76 C ${x + 42} 170, 180 160, 180 254`}
          delay={i * 0.3}
        />
      ))}
      {outs.map((x, i) => (
        <Wire
          key={`out-${x}`}
          id={`flow-tout-${i}`}
          d={`M180 386 C 180 480, ${x + 56} 470, ${x + 56} 564`}
          delay={1.4 + i * 0.4}
        />
      ))}
      {SOURCES.map((s, i) => (
        <Box
          key={s.title}
          node={{ x: ins[i] ?? 0, y: 12, w: 84, h: 64, title: s.title, sub: "" }}
        />
      ))}
      <Hub cx={180} cy={320} r={56} />
      {RESULTS.map((s, i) => (
        <Box
          key={s.title}
          node={{
            x: outs[i] ?? 0,
            y: 564,
            w: 112,
            h: 64,
            title: s.short,
            sub: "",
          }}
          accent
        />
      ))}
    </svg>
  );
}

export function MoneyFlow() {
  return (
    <figure className="grid gap-4">
      <div className="rounded-3xl border bg-card/60 p-4 shadow-primary/5 shadow-xl sm:p-8">
        <Wide />
        <Tall />
      </div>
      <figcaption className="sr-only">
        Amazon, Walmart, Noon and eBay send their money to Bookalyze, which posts it to your books,
        matches it to your bank deposits and works out your profit.
      </figcaption>
    </figure>
  );
}
