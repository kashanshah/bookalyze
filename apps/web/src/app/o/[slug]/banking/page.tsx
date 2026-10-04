import { redirect } from "next/navigation";

/** Banking's home is its list of bank accounts and connections. */
export default async function BankingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/o/${slug}/banking/accounts`);
}
