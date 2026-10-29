"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type NavMenuItem = { label: string; href: string; hint: string };

/**
 * A header item that opens a panel of links (Features → each feature page), on click or hover.
 * The app's copy of the site's (apps/marketing/src/components/nav-menu.tsx): plain links, since
 * they go to bookalyze.com.
 * Escape, a click elsewhere or following a link closes it; the panel ends with the item's own page.
 */
export function NavMenu({
  label,
  href,
  allLabel,
  items,
  current,
}: {
  label: string;
  href: string;
  allLabel: string;
  items: readonly NavMenuItem[];
  current: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The mouse is over the item: it opened on hover, so a click shouldn't close it again.
  const hovering = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const show = () => {
    if (closing.current) clearTimeout(closing.current);
    setOpen(true);
  };
  // A short pause, so moving from the button to the panel doesn't close it.
  const hide = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div
      ref={root}
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = true;
        show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = false;
        hide();
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (hovering.current ? show() : setOpen((v) => !v))}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm transition-colors hover:text-foreground lg:px-3",
          current || open ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div
          id={id}
          // Under the item on wide screens; below lg, across the header (inset from both edges)
          // so it never runs off the screen. The header's backdrop blur makes it the box for `fixed`.
          className="fade-in-0 zoom-in-95 slide-in-from-top-1 fixed inset-x-4 top-16 z-50 mx-auto max-w-[40rem] animate-in rounded-2xl border bg-card p-2 shadow-lg duration-150 lg:absolute lg:inset-x-auto lg:start-0 lg:top-full lg:mt-2 lg:w-[40rem] lg:max-w-none"
        >
          <ul className="grid gap-0.5 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="grid gap-0.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent focus-visible:bg-accent"
                >
                  <span className="font-medium text-sm">{item.label}</span>
                  <span className="text-muted-foreground text-xs leading-5">{item.hint}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t px-3 pt-2 pb-1">
            <a
              href={href}
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 font-medium text-primary text-sm underline-offset-4 hover:underline"
            >
              {allLabel}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The same links in the phone menu: the item opens to show them. */
export function NavMenuList({
  label,
  href,
  allLabel,
  items,
}: {
  label: string;
  href: string;
  allLabel: string;
  items: readonly NavMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="grid">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between rounded-md px-3 py-2.5 text-start font-medium text-base hover:bg-accent"
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open ? (
        <ul id={id} className="fade-in-0 grid animate-in gap-0.5 ps-3 pb-1 duration-150">
          {items.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="block rounded-md px-3 py-2 text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </a>
            </li>
          ))}
          <li>
            <a
              href={href}
              className="block rounded-md px-3 py-2 font-medium text-primary text-sm hover:bg-accent"
            >
              {allLabel}
            </a>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
