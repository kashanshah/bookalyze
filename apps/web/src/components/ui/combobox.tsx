"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Options with the same group are listed together under this heading, in order. */
  group?: string;
  /** A second line under the label, e.g. "Alberta, BC and the territories". */
  description?: string;
  /** Extra words the search matches but doesn't show, e.g. an account code or a currency name. */
  keywords?: string;
  disabled?: boolean;
};

/** Lists longer than this get a search box. */
const SEARCH_THRESHOLD = 7;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Every word typed must appear in the option's label, description or keywords (not its group). */
function matches(option: ComboboxOption, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = normalize(
    `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`,
  );
  return words.every((w) => haystack.includes(w));
}

/**
 * A dropdown that can be searched by typing: a drop-in for long native selects (accounts,
 * categories, countries). Options can be grouped and carry hidden keywords. The trigger is a
 * button, so `<Label htmlFor={id}>` labels it; `name` adds a hidden input for form posts.
 */
export function Combobox({
  id,
  name,
  value,
  onChange,
  options,
  placeholder = "Choose…",
  searchPlaceholder = "Type to search",
  emptyText = "Nothing matches.",
  searchable,
  disabled,
  invalid,
  className,
  wrapperClassName,
  contentClassName,
  footer,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  /** Shown on the trigger when nothing is chosen. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Defaults to on for lists longer than 7 options. */
  searchable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Classes for the trigger button. */
  className?: string;
  /** Classes for the wrapper, which is the layout item (e.g. grid spans). */
  wrapperClassName?: string;
  contentClassName?: string;
  /** Pinned under the list, e.g. "Add a new vendor". Gets the search text and a close function. */
  footer?: (query: string, close: () => void) => React.ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const optionId = (v: string) => `${baseId}-opt-${v}`;
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;
  const selected = options.find((o) => o.value === value);

  const filtered = React.useMemo(
    () => (query ? options.filter((o) => matches(o, query)) : options),
    [options, query],
  );
  const enabled = filtered.filter((o) => !o.disabled);

  // Grouped for display, keeping the order groups first appear in.
  const groups = React.useMemo(() => {
    const out: { group: string | undefined; items: ComboboxOption[] }[] = [];
    for (const option of filtered) {
      const last = out[out.length - 1];
      if (last && last.group === option.group) last.items.push(option);
      else out.push({ group: option.group, items: [option] });
    }
    return out;
  }, [filtered]);

  function openWith(initialQuery = "") {
    if (disabled) return;
    setQuery(initialQuery);
    setActive(initialQuery ? null : (selected?.value ?? null));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(option: ComboboxOption) {
    if (option.disabled) return;
    onChange(option.value);
    close();
  }

  // Keep a highlighted option: the current one if still visible, else the first match.
  const activeValue =
    active && enabled.some((o) => o.value === active) ? active : (enabled[0]?.value ?? null);

  React.useEffect(() => {
    if (!open || !activeValue) return;
    const el = document.getElementById(optionId(activeValue));
    el?.scrollIntoView({ block: "nearest" });
  });

  function onListKeyDown(e: React.KeyboardEvent) {
    const index = enabled.findIndex((o) => o.value === activeValue);
    const move = (to: number) => {
      const next = enabled[Math.max(0, Math.min(enabled.length - 1, to))];
      if (next) setActive(next.value);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(index - 1);
        break;
      case "Home":
        if (!withSearch) {
          e.preventDefault();
          move(0);
        }
        break;
      case "End":
        if (!withSearch) {
          e.preventDefault();
          move(enabled.length - 1);
        }
        break;
      case "PageDown":
        e.preventDefault();
        move(index + 8);
        break;
      case "PageUp":
        e.preventDefault();
        move(index - 8);
        break;
      case "Enter": {
        e.preventDefault();
        const option = enabled[index];
        if (option) choose(option);
        break;
      }
      case "Tab":
        close();
        break;
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => (next ? openWith() : close())}>
      <div className={cn("relative", wrapperClassName)}>
        <PopoverPrimitive.Trigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-haspopup="listbox"
            aria-invalid={invalid || undefined}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            disabled={disabled}
            data-slot="combobox"
            onKeyDown={(e) => {
              // Typing on the closed trigger starts a search, like a native select.
              if (!open && withSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                openWith(e.key);
              } else if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                openWith();
              }
            }}
            className={cn(
              "flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-card ps-3 pe-2.5 text-start text-base shadow-xs outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/15 data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/20 sm:text-sm",
              className,
            )}
          >
            <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverPrimitive.Trigger>
        {name ? <input type="hidden" name={name} value={value} /> : null}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (withSearch ? inputRef.current : listRef.current)?.focus({ preventScroll: true });
          }}
          className={cn(
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),16rem)] max-w-[calc(100vw-1.5rem)] origin-(--radix-popover-content-transform-origin) flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-black/5 shadow-xl data-[state=closed]:animate-out data-[state=open]:animate-in",
            contentClassName,
          )}
        >
          {withSearch ? (
            <div className="relative border-b">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(null);
                }}
                onKeyDown={onListKeyDown}
                placeholder={searchPlaceholder}
                role="combobox"
                aria-label={searchPlaceholder}
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeValue ? optionId(activeValue) : undefined}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 w-full bg-transparent ps-9 pe-3 text-base outline-none placeholder:text-muted-foreground/70 sm:text-sm"
              />
            </div>
          ) : null}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={withSearch ? undefined : -1}
            aria-activedescendant={!withSearch && activeValue ? optionId(activeValue) : undefined}
            aria-label={ariaLabel ?? placeholder}
            onKeyDown={withSearch ? undefined : onListKeyDown}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 outline-none"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-muted-foreground text-sm">{emptyText}</p>
            ) : (
              groups.map((g) => (
                // biome-ignore lint/a11y/useSemanticElements: a listbox group, not a fieldset
                <div
                  key={`${g.group ?? ""}:${g.items[0]?.value ?? ""}`}
                  role="group"
                  aria-label={g.group}
                >
                  {g.group ? (
                    <div
                      role="presentation"
                      className="sticky top-0 z-10 bg-popover px-2.5 pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider"
                    >
                      {g.group}
                    </div>
                  ) : null}
                  {g.items.map((option) => {
                    const isSelected = option.value === value;
                    const isActive = option.value === activeValue;
                    return (
                      // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the search box or listbox (aria-activedescendant)
                      // biome-ignore lint/a11y/useKeyWithClickEvents: the search box or listbox handles the keyboard
                      <div
                        key={option.value}
                        id={optionId(option.value)}
                        role="option"
                        aria-label={option.label}
                        aria-describedby={
                          option.description ? `${optionId(option.value)}-desc` : undefined
                        }
                        aria-selected={isSelected}
                        aria-disabled={option.disabled || undefined}
                        data-active={isActive || undefined}
                        onPointerMove={() => !option.disabled && setActive(option.value)}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => choose(option)}
                        className={cn(
                          "flex cursor-pointer select-none items-start gap-2 rounded-lg px-2.5 py-2 text-base outline-none sm:text-sm",
                          isActive && "bg-accent text-accent-foreground",
                          option.disabled && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{option.label}</span>
                          {option.description ? (
                            <span
                              id={`${optionId(option.value)}-desc`}
                              className="block truncate text-muted-foreground text-xs"
                            >
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                        <Check
                          className={cn(
                            "mt-0.5 size-4 shrink-0 text-primary",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                          strokeWidth={2.5}
                        />
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          {footer ? <div className="border-t p-1.5">{footer(query, close)}</div> : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
