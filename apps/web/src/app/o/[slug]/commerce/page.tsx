import { redirect } from "next/navigation";

/** Commerce opens on its channels until it has more screens. */
export default async function CommercePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/o/${slug}/commerce/channels`);
}
