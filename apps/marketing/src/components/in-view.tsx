"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Marks its box `data-inview="true"` the first time it scrolls into view, which starts the
 * `on-view-*` animations inside it (globals.css). Before then they wait, hidden.
 */
export function InView({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -15% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} data-inview={seen} className={className}>
      {children}
    </div>
  );
}
