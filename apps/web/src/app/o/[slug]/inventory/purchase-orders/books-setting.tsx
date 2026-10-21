"use client";

import { BookCheck, BookOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { formatDate } from "@/lib/dates";
import { savePurchaseSettingsAction } from "./actions";

/**
 * Whether purchase orders are in the books, and from when. Off, supplier payments go to
 * Inventory as they're categorised, and a card offers to put them in the books (a step to take).
 * On, an order's payments wait on Supplier deposits and each delivery moves its landed cost into
 * Inventory; nothing needs doing, so it's a quiet "How purchases post" button in the header that
 * opens the same explanation (and, for admins, the date).
 */
export function PurchaseBooksSetting({
  slug,
  locale,
  postFrom,
  suggested,
  canManage,
}: {
  slug: string;
  locale: string;
  postFrom: string | null;
  /** The first day of this month (or after the closed period). */
  suggested: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(postFrom ?? suggested);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const result = await savePurchaseSettingsAction(slug, date);
      if (!result.ok) {
        setError(result.errors?.postFrom ?? result.message);
        return;
      }
      toast.success(result.message, {
        description: result.problems.length
          ? `${result.problems.length} payment${result.problems.length === 1 ? "" : "s"} couldn't be moved: ${result.problems[0]}`
          : undefined,
      });
      setOpen(false);
      router.refresh();
    });

  const openDialog = () => {
    setDate(postFrom ?? suggested);
    setError(null);
    setOpen(true);
  };
  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {postFrom ? "How purchases post" : "Put purchases in the books"}
          </DialogTitle>
          <DialogDescription>
            {postFrom
              ? `In your books for orders from ${formatDate(postFrom, locale, "long")}. Your stock is valued at what it really cost, even when you pay in parts, in another currency, or before the goods arrive.`
              : "Your stock is then valued at what it really cost, even when you pay in parts, in another currency, or before the goods arrive."}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          <li className="flex gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              Payments on an order go to <strong>Supplier deposits</strong>: paid, but not in stock
              yet.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              Each delivery moves its landed cost (the order price, freight, duty…) from there into{" "}
              <strong>Inventory</strong>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              When everything has arrived, what's left (exchange rates that moved, a cost that
              changed) is settled as an exchange gain or loss.
            </span>
          </li>
        </ul>
        {canManage ? (
          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field
              label="For orders dated from"
              htmlFor={`${formId}-date`}
              error={error ?? undefined}
              hint="Earlier orders stay as they are. Payments already linked to later orders move to Supplier deposits, and their deliveries are posted."
            >
              <Input
                id={`${formId}-date`}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </form>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {canManage ? "Cancel" : "Close"}
          </Button>
          {canManage ? (
            <Button type="submit" form={formId} disabled={pending}>
              {pending ? <Spinner /> : null}
              {postFrom ? "Save" : "Put them in the books"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (postFrom) {
    return (
      <>
        <Button variant="ghost" onClick={openDialog}>
          <BookCheck />
          How purchases post
        </Button>
        {dialog}
      </>
    );
  }

  return (
    <section
      aria-label="Purchases in your books"
      className="fade-in-0 flex animate-in flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm shadow-xs"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <BookOpen className="size-4" />
      </span>
      <p className="min-w-[14rem] flex-1">
        <span className="font-medium">Purchases aren't in your books yet.</span>{" "}
        <span className="text-muted-foreground">
          Supplier payments go to Inventory as you categorise them.
        </span>
      </p>
      {canManage ? (
        <Button variant="outline" size="sm" onClick={openDialog}>
          Put purchases in the books
        </Button>
      ) : null}
      {dialog}
    </section>
  );
}
