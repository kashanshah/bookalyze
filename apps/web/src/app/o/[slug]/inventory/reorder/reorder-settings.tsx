"use client";

import { SlidersHorizontal } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { saveProductReorderAction, saveReorderSettingsAction } from "./actions";

const digits = (v: string) => v.replace(/[^\d]/g, "");

/** The company's lead time and how long each order should last. */
export function ReorderSettingsDialog({
  slug,
  leadTimeDays,
  coverDays,
}: {
  slug: string;
  leadTimeDays: number;
  coverDays: number;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [lead, setLead] = useState(String(leadTimeDays));
  const [cover, setCover] = useState(String(coverDays));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await saveReorderSettingsAction(slug, {
        leadTimeDays: lead,
        coverDays: cover,
      });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("Reorder settings saved", {
        description: "Every product's plan uses them, unless it has its own lead time.",
      });
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLead(String(leadTimeDays));
          setCover(String(coverDays));
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontal />
          Lead time and cover
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How you reorder</DialogTitle>
          <DialogDescription>
            Used for every product, unless you give a product its own lead time.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field
            label="Lead time (days)"
            htmlFor={`${formId}-lead`}
            error={errors.leadTimeDays}
            hint="From placing an order to the stock being ready to sell: making it, shipping it, and the marketplace receiving it."
          >
            <Input
              id={`${formId}-lead`}
              inputMode="numeric"
              value={lead}
              onChange={(e) => setLead(digits(e.target.value))}
              aria-invalid={Boolean(errors.leadTimeDays)}
              className="tabular-nums"
            />
          </Field>
          <Field
            label="Each order should last (days)"
            htmlFor={`${formId}-cover`}
            error={errors.coverDays}
            hint="How many days of sales an order covers once it arrives. Longer means bigger, less frequent orders."
          >
            <Input
              id={`${formId}-cover`}
              inputMode="numeric"
              value={cover}
              onChange={(e) => setCover(digits(e.target.value))}
              aria-invalid={Boolean(errors.coverDays)}
              className="tabular-nums"
            />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A product's own lead time, the supplier's minimum order and the units in a carton. */
export function ProductReorderDialog({
  slug,
  product,
  companyLeadTime,
}: {
  slug: string;
  product: {
    id: string;
    name: string;
    leadTimeDays: number | null;
    minimumOrder: number | null;
    casePack: number | null;
  };
  companyLeadTime: number;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const text = (n: number | null) => (n === null ? "" : String(n));
  const [lead, setLead] = useState(text(product.leadTimeDays));
  const [minimum, setMinimum] = useState(text(product.minimumOrder));
  const [pack, setPack] = useState(text(product.casePack));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await saveProductReorderAction(slug, {
        productId: product.id,
        leadTimeDays: lead,
        minimumOrder: minimum,
        casePack: pack,
      });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success(`Saved for ${product.name}`);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLead(text(product.leadTimeDays));
          setMinimum(text(product.minimumOrder));
          setPack(text(product.casePack));
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Reorder settings for ${product.name}`}>
          <SlidersHorizontal />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
          <DialogDescription>
            Only what's different for this product. Leave a box blank to use the usual.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field
            label="Lead time (days)"
            htmlFor={`${formId}-lead`}
            error={errors.leadTimeDays}
            hint={`Blank uses the company's ${companyLeadTime} days.`}
          >
            <Input
              id={`${formId}-lead`}
              inputMode="numeric"
              value={lead}
              placeholder={String(companyLeadTime)}
              onChange={(e) => setLead(digits(e.target.value))}
              aria-invalid={Boolean(errors.leadTimeDays)}
              className="tabular-nums"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Minimum order"
              htmlFor={`${formId}-min`}
              error={errors.minimumOrder}
              hint="The supplier's smallest order, in units."
            >
              <Input
                id={`${formId}-min`}
                inputMode="numeric"
                value={minimum}
                onChange={(e) => setMinimum(digits(e.target.value))}
                aria-invalid={Boolean(errors.minimumOrder)}
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Units in a carton"
              htmlFor={`${formId}-pack`}
              error={errors.casePack}
              hint="Orders round up to whole cartons."
            >
              <Input
                id={`${formId}-pack`}
                inputMode="numeric"
                value={pack}
                onChange={(e) => setPack(digits(e.target.value))}
                aria-invalid={Boolean(errors.casePack)}
                className="tabular-nums"
              />
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
