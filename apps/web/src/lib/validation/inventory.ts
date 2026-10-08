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
  unitWeight: z
    .string()
    .trim()
    .optional()
    .transform((v) => v?.replace(",", ".") || null)
    .refine(
      (v) => v === null || (/^\d+(\.\d{1,4})?$/.test(v) && Number(v) > 0 && Number(v) < 1e8),
      "Enter a weight like 0.45, or leave it empty.",
    ),
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
  /** The listing is a bundle: link this product alongside the others already in it. */
  bundle: z.boolean().optional(),
});
export type SkuLinkInput = z.input<typeof skuLinkSchema>;

/** A SKU as orders carry it (kept exactly, so it matches the order lines). */
export const skuFromOrdersSchema = z.object({
  channelId: z.uuid(),
  sku: z.string().min(1).max(200),
});

/** A listing that holds several products: each product and how many of it one listing holds. */
export const bundleSchema = z.object({
  channelId: z.uuid(),
  sku: z.string().min(1).max(200),
  components: z
    .array(
      z.object({
        productId: z.uuid("Choose a product."),
        units: z.coerce
          .number({ message: "How many?" })
          .int("Use a whole number.")
          .min(1, "At least 1.")
          .max(1000, "At most 1,000."),
      }),
    )
    .min(2, "A bundle holds two or more products.")
    .max(20, "Up to 20 products in a bundle.")
    .refine((c) => new Set(c.map((x) => x.productId)).size === c.length, "Each product once."),
});
