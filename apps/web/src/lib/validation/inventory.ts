import { z } from "zod";

const optional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => v || null);

export const productSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the product a name.")
    .max(200, "Keep the name under 200 characters."),
  sku: optional(80, "Keep your SKU under 80 characters."),
  notes: optional(2000, "Keep notes under 2,000 characters."),
});
export type ProductFormInput = z.input<typeof productSchema>;

export const skuLinkSchema = z.object({
  productId: z.uuid("Choose a product."),
  channelId: z.uuid("Choose a marketplace."),
  sku: z
    .string()
    .trim()
    .min(1, "Enter the SKU exactly as the marketplace shows it.")
    .max(200, "That SKU is too long."),
  units: z.coerce
    .number({ message: "Enter how many units one listing holds." })
    .int("Use a whole number.")
    .min(1, "At least 1.")
    .max(1000, "At most 1,000."),
});
export type SkuLinkInput = z.input<typeof skuLinkSchema>;

/** A SKU as orders carry it (kept exactly, so it matches the order lines). */
export const skuFromOrdersSchema = z.object({
  channelId: z.uuid(),
  sku: z.string().min(1).max(200),
});
