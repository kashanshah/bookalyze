"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;

const REACT_LAZY = Symbol.for("react.lazy");
type LazyNode = { $$typeof: symbol; _payload: unknown; _init: (payload: unknown) => unknown };
const isLazy = (node: unknown): node is LazyNode =>
  typeof node === "object" && node !== null && (node as LazyNode).$$typeof === REACT_LAZY;

/**
 * A trigger built on the server reaches the client as a lazy reference (sometimes one inside
 * another), which Radix's `asChild` can't always slot onto. Unwrap it first.
 */
function resolveNode(node: React.ReactNode): React.ReactNode {
  let current: unknown = node;
  while (isLazy(current)) {
    const payload = current._payload;
    current =
      typeof (payload as PromiseLike<unknown> | null)?.then === "function"
        ? React.use(payload as Promise<unknown>)
        : current._init(payload);
  }
  return current as React.ReactNode;
}

export function DialogTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  if (!asChild) return <DialogPrimitive.Trigger {...props}>{children}</DialogPrimitive.Trigger>;
  const child = resolveNode(children);
  return (
    <DialogPrimitive.Trigger asChild {...props}>
      {React.isValidElement(child) ? child : <span className="contents">{child}</span>}
    </DialogPrimitive.Trigger>
  );
}
export const DialogClose = DialogPrimitive.Close;

/** A centred dialog that becomes a bottom sheet on small screens. */
export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        className={cn(
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4 fixed inset-x-0 bottom-0 z-50 grid max-h-[92dvh] gap-5 overflow-y-auto rounded-t-2xl border bg-card p-5 shadow-2xl duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in sm:inset-x-auto sm:start-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6 rtl:sm:translate-x-1/2",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute end-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-1.5 pe-8", className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-semibold text-lg leading-tight tracking-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-muted-foreground text-sm leading-relaxed", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
