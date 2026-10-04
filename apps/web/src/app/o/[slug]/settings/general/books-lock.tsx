"use client";

import { Lock, LockOpen } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/shell/settings-section";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { setBooksLockAction } from "../../accounting/actions";

type Suggestion = { label: string; date: string };

/** Close the books through a date so nothing can be posted into a finished period. */
export function BooksLock({
  slug,
  lockedThrough,
  suggestions,
  locale,
  canEdit,
}: {
  slug: string;
  lockedThrough: string | null;
  suggestions: Suggestion[];
  locale: string;
  canEdit: boolean;
}) {
  const [date, setDate] = useState(lockedThrough ?? suggestions[0]?.date ?? "");
  const [error, setError] = useState<string>();
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!confirmReopen) return;
    const t = setTimeout(() => setConfirmReopen(false), 3000);
    return () => clearTimeout(t);
  }, [confirmReopen]);

  function save(next: string | null) {
    setError(undefined);
    startTransition(async () => {
      const result = await setBooksLockAction(slug, next);
      if (result.ok) {
        setConfirmReopen(false);
        toast.success(
          next
            ? `Books closed through ${formatDate(next, locale, "long")}`
            : "All periods reopened",
        );
      } else {
        setError(result.errors?.date);
        if (result.message) toast.error(result.message);
      }
    });
  }

  return (
    <SettingsSection
      className="border-t"
      title="Close the books"
      description="Once a year is finished or a tax return is filed, close it so nobody can change it by accident. Entries dated on or before the closing date can't be added or reversed."
    >
      <div className="grid gap-5">
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors",
            lockedThrough ? "border-primary/25 bg-primary/5" : "bg-muted/40",
          )}
        >
          {lockedThrough ? (
            <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : (
            <LockOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <p>
            {lockedThrough ? (
              <>
                Books are closed through{" "}
                <span className="font-semibold">{formatDate(lockedThrough, locale, "long")}</span>.
                New entries must be dated after it.
              </>
            ) : (
              "All periods are open. Entries can be dated any day."
            )}
          </p>
        </div>

        {canEdit ? (
          <fieldset disabled={pending} className="grid gap-4">
            <Field
              label="Closed through"
              htmlFor="booksLockedThrough"
              error={error}
              hint="Usually the last day of a financial year or tax filing period."
              className="max-w-xs"
            >
              <Input
                id="booksLockedThrough"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            {suggestions.length ? (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setDate(s.date)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      date === s.date
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:border-primary/30 hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!date || date === lockedThrough}
                onClick={() => save(date)}
              >
                {pending ? <Spinner /> : <Lock />}
                Close books through this date
              </Button>
              {lockedThrough ? (
                <Button
                  type="button"
                  variant={confirmReopen ? "destructive" : "ghost"}
                  onClick={() => (confirmReopen ? save(null) : setConfirmReopen(true))}
                >
                  <LockOpen />
                  {confirmReopen ? "Click again to reopen" : "Reopen all periods"}
                </Button>
              ) : null}
            </div>
          </fieldset>
        ) : (
          <p className="text-muted-foreground text-sm">
            Only owners and admins can close or reopen the books.
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
