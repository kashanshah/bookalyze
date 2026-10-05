"use client";

import { COMPLIANCE_RECURRENCES, type ComplianceRecurrence, daysBetween } from "@bookalyze/core";
import { CalendarClock, Check, Plus, Trash2 } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { CalendarEntry } from "@/server/compliance";
import { deleteComplianceItemAction, saveComplianceItemAction, setDoneAction } from "../actions";

type CustomItem = {
  id: string;
  title: string;
  notes: string | null;
  firstDue: string;
  recurrence: ComplianceRecurrence;
};

const SOURCE_LABEL: Record<CalendarEntry["source"], string> = {
  rule: "Required filing",
  tax: "Sales tax",
  document: "Renewal",
  custom: "Your item",
};

function when(today: string, dueDate: string) {
  const days = daysBetween(today, dueDate);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} overdue`;
  return `In ${days} days`;
}

export function CalendarList({
  slug,
  locale,
  today,
  entries,
  custom,
}: {
  slug: string;
  locale: string;
  today: string;
  entries: CalendarEntry[];
  custom: CustomItem[];
}) {
  const [items, setOptimistic] = useOptimistic(
    entries,
    (current, change: { occurrence: string; done: boolean }) =>
      current.map((e) => (e.occurrence === change.occurrence ? { ...e, done: change.done } : e)),
  );
  const [, start] = useTransition();
  const [editing, setEditing] = useState<CustomItem | "new" | null>(null);
  const [key, setKey] = useState(0);
  const open = (value: CustomItem | "new") => {
    setKey((k) => k + 1);
    setEditing(value);
  };

  const toggle = (entry: CalendarEntry) =>
    start(async () => {
      setOptimistic({ occurrence: entry.occurrence, done: !entry.done });
      const result = await setDoneAction(slug, {
        itemKey: entry.key,
        dueDate: entry.dueDate,
        done: !entry.done,
      });
      if (!result.ok) return void toast.error(result.message);
      if (!entry.done)
        toast.success("Marked as done", { description: "No more reminders for it." });
    });

  const overdue = items.filter((e) => e.dueDate < today && !e.done);
  const upcoming = items.filter((e) => e.dueDate >= today);
  const months = new Map<string, CalendarEntry[]>();
  for (const e of upcoming) {
    const month = e.dueDate.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), e]);
  }
  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${month}-01T00:00:00Z`),
    );

  const row = (entry: CalendarEntry, i: number) => {
    const item = entry.source === "custom" ? custom.find((c) => c.id === entry.refId) : undefined;
    const days = daysBetween(today, entry.dueDate);
    return (
      <li
        key={entry.occurrence}
        className={cn(
          "fade-in-0 flex animate-in items-start gap-3 fill-mode-both px-4 py-3.5 sm:gap-4 sm:px-5",
          entry.done && "opacity-60",
        )}
        style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
      >
        <div className="flex w-12 shrink-0 flex-col items-center rounded-xl border bg-background py-1.5 text-center">
          <span className="font-medium text-[10px] text-muted-foreground uppercase">
            {new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
              new Date(`${entry.dueDate}T00:00:00Z`),
            )}
          </span>
          <span className="tabular font-semibold text-lg leading-tight">
            {Number(entry.dueDate.slice(8, 10))}
          </span>
        </div>
        <button
          type="button"
          disabled={!item}
          onClick={() => item && open(item)}
          className="min-w-0 flex-1 text-start disabled:cursor-default"
        >
          <p className={cn("font-medium", entry.done && "line-through")}>{entry.title}</p>
          {entry.hint ? <p className="mt-0.5 text-muted-foreground text-sm">{entry.hint}</p> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={entry.source === "custom" ? "primary" : "secondary"}>
              {SOURCE_LABEL[entry.source]}
            </Badge>
            {entry.done ? null : (
              <Badge variant={days < 0 || days <= 7 ? "warning" : "outline"}>
                {when(today, entry.dueDate)}
              </Badge>
            )}
          </p>
        </button>
        <button
          type="button"
          onClick={() => toggle(entry)}
          aria-pressed={entry.done}
          aria-label={
            entry.done
              ? `Mark “${entry.title}” due ${formatDate(entry.dueDate, locale)} as not done`
              : `Mark “${entry.title}” due ${formatDate(entry.dueDate, locale)} as done`
          }
          title={entry.done ? "Done" : "Mark as done"}
          className={cn(
            "mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border transition-all duration-200",
            entry.done
              ? "border-success bg-success text-white"
              : "text-transparent hover:border-success/60 hover:text-success/60",
          )}
        >
          <Check
            className={cn("size-4", entry.done && "zoom-in-50 animate-in")}
            strokeWidth={2.5}
          />
        </button>
      </li>
    );
  };

  return (
    <div className="grid gap-6">
      <div className="flex justify-end">
        <Button onClick={() => open("new")}>
          <Plus />
          Add an item
        </Button>
      </div>

      {overdue.length ? (
        <section className="grid gap-2" aria-label="Overdue">
          <h2 className="font-semibold text-sm">Overdue</h2>
          <ul className="divide-y overflow-hidden rounded-2xl border border-warning/40 bg-warning/[0.06] shadow-xs">
            {overdue.map(row)}
          </ul>
        </section>
      ) : null}

      {upcoming.length ? (
        [...months].map(([month, list]) => (
          <section key={month} className="grid gap-2" aria-label={monthLabel(month)}>
            <h2 className="font-semibold text-sm">{monthLabel(month)}</h2>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
              {list.map(row)}
            </ul>
          </section>
        ))
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
          <CalendarClock className="size-6 text-muted-foreground" />
          <p className="font-medium">Nothing due in the next year</p>
          <p className="max-w-md text-muted-foreground text-sm">
            Add the company's details and registrations, or your own items like insurance renewals
            and payroll remittances.
          </p>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => (o ? null : setEditing(null))}>
        <DialogContent>
          {editing ? (
            <ItemForm
              key={key}
              slug={slug}
              item={editing === "new" ? null : editing}
              today={today}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemForm({
  slug,
  item,
  today,
  onDone,
}: {
  slug: string;
  item: CustomItem | null;
  today: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [firstDue, setFirstDue] = useState(item?.firstDue ?? today);
  const [recurrence, setRecurrence] = useState<ComplianceRecurrence>(item?.recurrence ?? "yearly");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [removing, startRemove] = useTransition();
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await saveComplianceItemAction(slug, {
            id: item?.id ?? "",
            title,
            notes,
            firstDue,
            recurrence,
          });
          if (!result.ok) {
            setErrors(result.errors ?? {});
            if (result.message) toast.error(result.message);
            return;
          }
          toast.success(item ? "Saved" : "Added to the calendar");
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{item ? "Change item" : "Add to the calendar"}</DialogTitle>
        <DialogDescription>
          Anything with a deadline: an insurance renewal, a payroll remittance, a lease.
        </DialogDescription>
      </DialogHeader>
      <Field label="What's due?" htmlFor="item-title" error={errors.title}>
        <Input
          id="item-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Renew business insurance"
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field
          label={recurrence === "once" ? "Due on" : "First due on"}
          htmlFor="item-due"
          error={errors.firstDue}
        >
          <Input
            id="item-due"
            type="date"
            value={firstDue}
            onChange={(e) => setFirstDue(e.target.value)}
          />
        </Field>
        <Field label="Repeats" htmlFor="item-recurrence" error={errors.recurrence}>
          <Combobox
            id="item-recurrence"
            value={recurrence}
            onChange={(v) => setRecurrence(v as ComplianceRecurrence)}
            options={COMPLIANCE_RECURRENCES.map((r) => ({ value: r.key, label: r.label }))}
          />
        </Field>
      </div>
      <Field
        label="Notes (optional)"
        htmlFor="item-notes"
        error={errors.notes}
        hint="Shown under the item and in the reminder email."
      >
        <Textarea
          id="item-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <DialogFooter className="sm:justify-between">
        {item ? (
          <Button
            type="button"
            variant="ghost"
            disabled={removing}
            onClick={() =>
              startRemove(async () => {
                const result = await deleteComplianceItemAction(slug, item.id);
                if (!result.ok) return void toast.error(result.message);
                toast.success("Removed from the calendar");
                onDone();
              })
            }
          >
            {removing ? <Spinner /> : <Trash2 />}
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {item ? "Save" : "Add"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
