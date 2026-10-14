import { decimalPlaces, isAmazonSellerId, isDecimal } from "@bookalyze/core";
import { z } from "zod";

const price = z
  .string()
  .trim()
  .transform((v) => v.replace(",", "."))
  .refine((v) => isDecimal(v) && !v.startsWith("-") && Number(v) > 0, "Enter a price, e.g. 19.99.")
  .refine((v) => !isDecimal(v) || decimalPlaces(v) <= 2, "Use cents at most, e.g. 19.99.")
  .refine((v) => !isDecimal(v) || Number(v) < 1_000_000, "That's more than Amazon allows.");

export const priceSchema = z.object({
  channelId: z.uuid("Choose a marketplace."),
  sku: z.string().trim().min(1, "Choose a SKU.").max(200),
  price,
});

export const sellerIdSchema = z.object({
  connectionId: z.uuid(),
  sellerId: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine(
      isAmazonSellerId,
      "That doesn't look like a merchant token (letters and digits, e.g. A1B2C3D4E5F6G7).",
    ),
});
