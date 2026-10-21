import { listUnlinkedAttachments } from "@bookalyze/db";
import type { Metadata } from "next";
import { CopyAddress } from "@/components/copy-address";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { loadInvoiceInbox } from "@/server/invoice-requests";
import { storageDriver } from "@/server/storage";
import { ReceiptsInbox } from "./receipts-inbox";

export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const [files, inbox] = await Promise.all([
    inOrg(ctx, (tx) => listUnlinkedAttachments(tx)),
    loadInvoiceInbox(ctx, "receipts"),
  ]);
  const ready = storageDriver() !== "none";
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Accounting"
        title="Receipts"
        description="Snap or drop receipts here as you get them, then attach each one to its transaction when it shows up. You can also add receipts straight from a transaction."
      />
      {ready ? null : (
        <Alert>
          File storage isn't connected yet, so receipts can't be uploaded. An admin needs to add the
          S3 settings described in docs/SETUP.md.
        </Alert>
      )}
      {ready && inbox.address ? (
        <details className="group rounded-2xl border bg-card px-5 py-4 shadow-xs">
          <summary className="cursor-pointer list-none font-medium text-sm">
            Forward receipts and bills by email
            <span className="ms-2 font-normal text-muted-foreground">
              PDFs and photos sent here land in this inbox.
            </span>
          </summary>
          <div className="mt-4 grid gap-3 text-sm">
            <CopyAddress address={inbox.address} />
            <p className="text-muted-foreground">
              Forward a supplier's invoice or a receipt email with its file attached, or set a mail
              filter to forward them for you (Gmail asks to confirm a new forwarding address: its
              code shows below). Files arrive here unattached, ready to match to their transaction.
            </p>
            {inbox.lastOtherSubject ? (
              <p className="rounded-xl border bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Latest email without a file: </span>
                <span className="font-medium">{inbox.lastOtherSubject}</span>
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
      <ReceiptsInbox
        slug={slug}
        locale={ctx.profile.locale}
        canUpload={ready}
        files={files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          createdAt: f.createdAt.toISOString(),
          url: `/api/o/${slug}/attachments/${f.id}`,
          emailFrom: f.emailFrom,
          emailSubject: f.emailSubject,
        }))}
      />
    </div>
  );
}
