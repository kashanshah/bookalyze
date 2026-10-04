import { listUnlinkedAttachments } from "@bookalyze/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { storageDriver } from "@/server/storage";
import { ReceiptsInbox } from "./receipts-inbox";

export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const files = await inOrg(ctx, (tx) => listUnlinkedAttachments(tx));
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
        }))}
      />
    </div>
  );
}
