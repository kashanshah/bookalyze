"use client";

import { CircleCheck, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setTicketSolvedAction } from "./actions";

/** Mark solved, or open a solved ticket again. */
export function SolvedButton({
  slug,
  ticketId,
  solved,
}: {
  slug: string;
  ticketId: string;
  solved: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await setTicketSolvedAction(slug, { ticketId, solved: !solved });
          if (!result.ok) {
            toast.error(result.message ?? "That didn't work. Try again.");
            return;
          }
          toast.success(solved ? "Opened again" : "Marked as solved");
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : solved ? <RotateCcw /> : <CircleCheck />}
      {solved ? "Open again" : "Mark as solved"}
    </Button>
  );
}
