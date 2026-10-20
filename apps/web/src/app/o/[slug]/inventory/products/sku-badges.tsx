"use client";

import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const GAP = 6; // gap-1.5
const MORE_WIDTH = 76; // room kept for the "+N more" chip

/**
 * A product's marketplace SKUs on one line: as many as fit, then "+N more", which shows them all
 * on hover or click.
 */
export function SkuBadges({ items, label }: { items: React.ReactNode[]; label: string }) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(items.length);
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    // Badges past the line stay in the page (invisible), so every badge can be measured again
    // when the row resizes or the web font arrives.
    const fitToRow = () => {
      const widths = Array.from(row.querySelectorAll<HTMLElement>(":scope > [data-sku]")).map(
        (el) => el.offsetWidth,
      );
      const space = row.clientWidth;
      const all = widths.reduce((sum, w, i) => sum + w + (i ? GAP : 0), 0);
      if (all <= space) return setShown(widths.length);
      let used = MORE_WIDTH;
      let n = 0;
      for (const w of widths) {
        if (used + w + GAP > space) break;
        used += w + GAP;
        n++;
      }
      setShown(Math.max(1, n));
    };
    fitToRow();
    let live = true;
    document.fonts?.ready.then(() => live && fitToRow());
    const observer = new ResizeObserver(fitToRow);
    observer.observe(row);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);

  React.useEffect(() => () => clearTimeout(closeTimer.current), []);

  const hidden = items.length - shown;
  const openNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div
      ref={rowRef}
      className="relative flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden"
    >
      {items.map((item, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for the row's life
          key={i}
          data-sku=""
          aria-hidden={i >= shown || undefined}
          className={cn("shrink-0", i >= shown && "invisible absolute")}
        >
          {item}
        </span>
      ))}
      {hidden > 0 ? (
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
          <PopoverPrimitive.Trigger
            className="shrink-0 cursor-pointer whitespace-nowrap rounded-full border border-dashed px-2.5 py-0.5 font-medium text-muted-foreground text-xs transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-primary/40 data-[state=open]:text-primary"
            aria-label={`Show all ${items.length} marketplace SKUs for ${label}`}
            onPointerEnter={(e) => e.pointerType === "mouse" && openNow()}
            onPointerLeave={(e) => e.pointerType === "mouse" && closeSoon()}
          >
            +{hidden} more
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              align="start"
              sideOffset={6}
              collisionPadding={12}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onPointerEnter={(e) => e.pointerType === "mouse" && openNow()}
              onPointerLeave={(e) => e.pointerType === "mouse" && closeSoon()}
              className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-max max-w-[min(28rem,calc(100vw-1.5rem))] origin-(--radix-popover-content-transform-origin) rounded-xl border bg-popover p-3 text-popover-foreground shadow-black/5 shadow-xl data-[state=closed]:animate-out data-[state=open]:animate-in"
            >
              <p className="mb-2 text-muted-foreground text-xs">{items.length} marketplace SKUs</p>
              <div className="flex flex-wrap gap-1.5">
                {items.map((item, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for the row's life
                  <React.Fragment key={i}>{item}</React.Fragment>
                ))}
              </div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      ) : null}
    </div>
  );
}
