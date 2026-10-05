import { listEntityDocuments } from "@bookalyze/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getEntityContext } from "@/server/compliance";
import { storageDriver } from "@/server/storage";
import { DocumentVault } from "./vault";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getEntityContext(slug);
  const documents = await inOrg(ctx, (tx) => listEntityDocuments(tx));
  const ready = storageDriver() !== "none";
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Company"
        title="Documents"
        description="Licenses, articles, certificates and filings, kept safe in one place. Add an expiry date and the renewal goes on the compliance calendar."
      />
      {ready ? null : (
        <Alert>
          File storage isn't connected yet, so documents can't be uploaded. An admin needs to add
          the S3 settings described in docs/SETUP.md.
        </Alert>
      )}
      <DocumentVault
        slug={slug}
        locale={ctx.profile.locale}
        today={nowIn(ctx.profile.timezone).date}
        canUpload={ready}
        documents={documents.map((d) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          expiresOn: d.expiresOn,
          fileName: d.fileName,
          sizeBytes: d.sizeBytes,
          url: `/api/o/${slug}/attachments/${d.attachmentId}`,
        }))}
      />
    </div>
  );
}
