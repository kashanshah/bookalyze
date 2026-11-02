"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setSkuDropshipAction } from "./actions";

export type DropshipSkuView = {
  channelId: string;
  channelName: string;
  sku: string;
  title: string | null;
  orders: number;
};

/** SKUs a partner ships: folded away, each with a way back to "not linked". */
export function DropshipSkus({ slug, rows }: { slug: string; rows: DropshipSkuView[] }) {
  return (
    <details className="group rounded-2xl border bg-card px-5 py-4 shadow-xs">
      <summary className="cursor-pointer list-none font-medium text-sm">
        Dropship SKUs ({rows.length})
        <span className="ms-2 font-normal text-muted-foreground">
          A partner ships these, so they're left out of stock and cost of goods sold.
        </span>
      </summary>
      <ul className="mt-4 divide-y rounded-xl border">
        {rows.map((row) => (
          <DropshipRow key={`${row.channelId}:${row.sku}`} slug={slug} row={row} />
        ))}
      </ul>
    </details>
  );
}

function DropshipRow({ slug, row }: { slug: string; row: DropshipSkuView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <li
      aria-label={row.sku}
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{row.sku}</p>
        <p className="truncate text-muted-foreground text-xs" title={row.title ?? undefined}>
          {row.channelName}
          {row.title ? ` · ${row.title}` : ""}
          {` · ${row.orders} ${row.orders === 1 ? "order" : "orders"}`}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        className="self-start sm:self-auto"
        onClick={() =>
          startTransition(async () => {
            const result = await setSkuDropshipAction(
              slug,
              { channelId: row.channelId, sku: row.sku },
              false,
            );
            if (result.ok) {
              toast.success(`${row.sku} ships from your stock`, {
                description: "Link it to a product under SKUs that aren't linked.",
              });
              router.refresh();
            } else toast.error(result.message);
          })
        }
      >
        {pending ? <Spinner /> : <Undo2 />}
        Ships from my stock
      </Button>
    </li>
  );
}
