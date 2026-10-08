import "server-only";
import { can } from "@bookalyze/core";
import { notFound } from "next/navigation";
import type { CommerceContext } from "./commerce";
import { getOrgContext } from "./org";

/** The context for Inventory pages and actions: the Inventory module must be on. */
export async function getInventoryContext(
  slug: string,
  feature = "inventory.products",
): Promise<CommerceContext> {
  const ctx = await getOrgContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, feature) || !ctx.profile) notFound();
  return ctx as CommerceContext;
}
