"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { syncAmazonSkusAction } from "./actions";

/** Brings in every SKU Amazon holds stock for, including variations that haven't sold yet. */
export function AmazonSkusButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await syncAmazonSkusAction(slug);
          if (!result.ok) {
            toast.error("Amazon's SKUs couldn't be brought in", { description: result.message });
            return;
          }
          toast.success(
            result.skus === 1
              ? "1 SKU checked with Amazon"
              : `${result.skus} SKUs checked with Amazon`,
            {
              description:
                "Every SKU Amazon holds stock for is listed, including variations that haven't sold yet.",
            },
          );
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <RefreshCw />}
      Check Amazon for all SKUs
    </Button>
  );
}
