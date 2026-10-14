"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { saveSellerIdAction } from "./actions";

/**
 * Amazon needs the seller ID (merchant token) to read and change listings. Bookalyze finds it
 * from a listing's offers; this is for when Amazon doesn't say.
 */
export function SellerIdForm({
  slug,
  connectionId,
  connectionName,
  canChange,
}: {
  slug: string;
  connectionId: string;
  connectionName: string;
  canChange: boolean;
}) {
  const router = useRouter();
  const [sellerId, setSellerId] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const id = `seller-id-${connectionId}`;
  return (
    <form
      className="fade-in-0 grid animate-in gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:grid-cols-[auto_minmax(0,1fr)]"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await saveSellerIdAction(slug, { connectionId, sellerId });
          if (!result.ok) {
            setError(result.errors?.sellerId);
            if (!result.errors) toast.error(result.message);
            return;
          }
          toast.success("Seller ID saved", { description: "Now check Amazon for prices." });
          router.refresh();
        });
      }}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <KeyRound className="size-5" />
      </span>
      <div className="grid gap-3">
        <div>
          <p className="font-medium text-sm">Your seller ID for {connectionName}</p>
          <p className="text-muted-foreground text-sm">
            Amazon needs it to read and change your listings. We find it ourselves when you check
            prices; if Amazon doesn't say, paste it here.
          </p>
        </div>
        {canChange ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Merchant token"
              htmlFor={id}
              hint="Seller Central → Settings → Account Info → Merchant Token."
              error={error}
              className="w-full sm:w-72"
            >
              <Input
                id={id}
                value={sellerId}
                onChange={(e) => {
                  setSellerId(e.target.value);
                  setError(undefined);
                }}
                placeholder="A1B2C3D4E5F6G7"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={pending || !sellerId.trim()}>
              {pending ? <Spinner /> : null}
              Save
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">An owner or admin can add it.</p>
        )}
      </div>
    </form>
  );
}
