"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { refreshPricesAction } from "./actions";

/** Reads each listing's price from Amazon, asking again while there's more to read. */
export function RefreshPricesButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          let checked = 0;
          for (let round = 0; round < 10; round++) {
            const result = await refreshPricesAction(slug);
            if (!result.ok) {
              toast.error("Prices couldn't be checked", { description: result.message });
              break;
            }
            checked += result.checked;
            if (result.needsSellerId) {
              toast.warning("Amazon didn't tell us your seller ID", {
                description: "Add your merchant token above, then check again.",
              });
              break;
            }
            if (!result.remaining) {
              toast.success(
                checked === 1
                  ? "1 price checked with Amazon"
                  : `${checked} prices checked with Amazon`,
                result.message ? { description: result.message } : undefined,
              );
              break;
            }
          }
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <RefreshCw />}
      Check Amazon for prices
    </Button>
  );
}
