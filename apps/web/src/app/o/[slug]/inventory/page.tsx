import { redirect } from "next/navigation";

/** Inventory opens on its products. */
export default async function InventoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/o/${slug}/inventory/products`);
}
