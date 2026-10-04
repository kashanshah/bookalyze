import { redirect } from "next/navigation";
import { getAccountingContext, listAccounts } from "@/server/accounting";

/** The Accounting module's home: the journal, or the chart of accounts until one exists. */
export default async function AccountingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const accounts = await listAccounts(ctx);
  redirect(`/o/${slug}/accounting/${accounts.length ? "journal" : "accounts"}`);
}
