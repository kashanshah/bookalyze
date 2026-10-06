"use client";

import { BookCheck, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { postSettlementsAction, unpostSettlementAction } from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Post to books" for one settlement. */
export function PostSettlementButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      onClick={() =>
        start(async () => {
          const result = await postSettlementsAction(slug, { id });
          if (!result.ok) return void toast.error(result.message);
          toast.success("In your books", {
            description: "Match its deposit to the clearing account when it reaches your bank.",
          });
          router.refresh();
        })
      }
      disabled={pending}
    >
      {pending ? <Spinner /> : <BookCheck />}
      {pending ? "Posting…" : "Post to books"}
    </Button>
  );
}

/** "Take out of books": reverses the settlement's entry. */
export function UnpostSettlementButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() =>
        start(async () => {
          const result = await unpostSettlementAction(slug, id);
          if (!result.ok) return void toast.error(result.message);
          toast.success("Taken out of your books", {
            description: "Its entry was reversed. You can post it again.",
          });
          router.refresh();
        })
      }
      disabled={pending}
    >
      {pending ? <Spinner /> : <Undo2 />}
      Take out of books
    </Button>
  );
}

/** "Post N ready": every settlement from the start date on that isn't in the books. */
export function PostAllSettlementsButton({ slug, count }: { slug: string; count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      onClick={() =>
        start(async () => {
          const result = await postSettlementsAction(slug, { all: true });
          if (!result.ok) return void toast.error(result.message);
          router.refresh();
          if (result.posted) {
            toast.success(
              `${plural(result.posted, "settlement")} in your books`,
              result.failed
                ? {
                    description: `${plural(result.failed, "settlement")} couldn't post: ${result.message}`,
                  }
                : {},
            );
          } else if (result.message) {
            toast.error(result.message);
          }
        })
      }
      disabled={pending}
    >
      {pending ? <Spinner /> : <BookCheck />}
      {pending ? "Posting…" : `Post ${count} ready`}
    </Button>
  );
}
