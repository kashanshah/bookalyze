"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Values change in place from this width up (Tailwind's `lg`); narrower, a row opens instead. */
export const isWide = () => window.matchMedia("(min-width: 64rem)").matches;

/**
 * Classes for a Combobox trigger in a row: plain text on phones, and on wide screens text that
 * shows it's a dropdown when hovered.
 */
export const inlineTrigger =
  "h-auto border-0 bg-transparent p-0 text-xs shadow-none sm:text-xs [&>svg]:hidden lg:h-8 lg:border lg:border-transparent lg:ps-2 lg:pe-1.5 lg:text-sm lg:data-[state=open]:bg-card lg:hover:border-input lg:hover:bg-card lg:[&>svg]:block lg:[&>svg]:opacity-0 lg:focus-visible:[&>svg]:opacity-100 lg:group-hover/row:[&>svg]:opacity-100 lg:data-[state=open]:[&>svg]:opacity-100";

const idle =
  "flex w-full min-w-0 items-center rounded-md text-start outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20 lg:min-h-8 lg:border lg:border-transparent lg:px-2 lg:transition-colors lg:focus-visible:border-ring lg:hover:border-input lg:hover:bg-card";

/** A row value that opens the full transaction when clicked (it can't be changed in place). */
export function StaticCell({
  children,
  onClick,
  label,
  align = "start",
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(idle, "lg:py-1", align === "end" && "justify-end text-end", className)}
    >
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/**
 * Text that turns into an input when clicked. Enter or leaving the field saves, Escape cancels.
 * Nothing is saved when the value didn't change.
 */
export function InlineInput({
  value,
  display,
  onCommit,
  label,
  type = "text",
  inputMode,
  min,
  maxLength,
  placeholder,
  align = "start",
  className,
}: {
  value: string;
  display: React.ReactNode;
  onCommit: (next: string) => void;
  label: string;
  type?: "text" | "date";
  inputMode?: "decimal";
  min?: string;
  maxLength?: number;
  placeholder?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const settled = useRef(false);

  function finish(save: boolean) {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const next = draft.trim();
    if (save && next !== value.trim()) onCommit(next);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        type={type}
        value={draft}
        min={min}
        maxLength={maxLength}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-label={label}
        onFocus={(e) => type === "text" && e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
        className={cn("h-8 px-2", align === "end" && "tabular text-end")}
      />
    );
  }
  return (
    <button
      type="button"
      title={`Click to change the ${label.toLowerCase()}`}
      onClick={() => {
        settled.current = false;
        setDraft(value);
        setEditing(true);
      }}
      className={cn(idle, "lg:h-8", align === "end" && "justify-end text-end", className)}
    >
      <span className="min-w-0 truncate">{display}</span>
    </button>
  );
}
