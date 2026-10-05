"use client";

import { FileUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type StatementAccount, StatementUploadDialog } from "./statement-upload-dialog";

/** A button that opens the statement upload, optionally for one account. */
export function StatementUploadButton({
  slug,
  accounts,
  accountId,
  locale,
  label = "Upload a statement",
  variant = "outline",
}: {
  slug: string;
  accounts: StatementAccount[];
  accountId?: string;
  locale: string;
  label?: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        disabled={!accounts.length}
        title={
          accounts.length
            ? undefined
            : "Add a bank or card account to your chart of accounts first."
        }
      >
        <FileUp />
        {label}
      </Button>
      <StatementUploadDialog
        key={key}
        slug={slug}
        accounts={accounts}
        defaultAccountId={accountId}
        open={open}
        onOpenChange={setOpen}
        locale={locale}
      />
    </>
  );
}
