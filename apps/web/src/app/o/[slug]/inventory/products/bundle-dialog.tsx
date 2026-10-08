"use client";

import { Boxes, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { makeBundleAction } from "./actions";

type Part = { key: number; productId: string; units: string };

/** Links one listing to several products: a gift set, a kit, a variety pack. */
export function BundleDialog({
  slug,
  channelId,
  sku,
  title,
  products,
}: {
  slug: string;
  channelId: string;
  sku: string;
  title: string | null;
  products: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [nextKey, setNextKey] = useState(2);
  const [pending, start] = useTransition();
  const fresh = () => [
    { key: 0, productId: "", units: "1" },
    { key: 1, productId: "", units: "1" },
  ];
  const update = (key: number, patch: Partial<Part>) =>
    setParts((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const submit = () =>
    start(async () => {
      const result = await makeBundleAction(slug, {
        channelId,
        sku,
        components: parts
          .filter((p) => p.productId)
          .map((p) => ({ productId: p.productId, units: p.units })),
      });
      if (!result.ok) return void toast.error(result.message);
      setOpen(false);
      toast.success(`${sku} is a bundle now`, {
        description: "Each sale counts toward every product in it.",
      });
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setParts(fresh());
          setNextKey(2);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={products.length < 2}>
          <Boxes />
          Bundle
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Make {sku} a bundle</DialogTitle>
          <DialogDescription>
            {title ? `${title}. ` : ""}Choose the products one listing holds, and how many of each.
            Every sale then counts toward each of them, and costs them from their own stock lots.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`bundle-${sku}`}
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {parts.map((part, i) => (
            <div key={part.key} className="grid grid-cols-[minmax(0,1fr)_5rem_2.25rem] gap-2">
              <Combobox
                aria-label={`Bundle product ${i + 1}`}
                value={part.productId}
                onChange={(productId) => update(part.key, { productId })}
                placeholder="Choose a product…"
                searchPlaceholder="Find a product"
                options={products.map((p) => ({
                  value: p.id,
                  label: p.name,
                  disabled: parts.some((o) => o.key !== part.key && o.productId === p.id),
                }))}
              />
              <Input
                aria-label={`How many of product ${i + 1}`}
                inputMode="numeric"
                value={part.units}
                onChange={(e) => update(part.key, { units: e.target.value.trim() })}
                className="text-end tabular-nums"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove product ${i + 1}`}
                disabled={parts.length <= 2}
                onClick={() => setParts((all) => all.filter((p) => p.key !== part.key))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => {
              setParts((all) => [...all, { key: nextKey, productId: "", units: "1" }]);
              setNextKey((k) => k + 1);
            }}
          >
            <Plus />
            Add a product
          </Button>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={`bundle-${sku}`} disabled={pending}>
            {pending ? <Spinner /> : <Boxes />}
            Save bundle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
