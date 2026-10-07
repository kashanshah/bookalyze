import {
  LISTING_CADENCES,
  LISTING_CHECK_KEYS,
  type ListingCadence,
  type ListingCheck,
  listingWatchIssue,
  normalizeAsin,
} from "@bookalyze/core";
import { z } from "zod";

const cadenceKeys = LISTING_CADENCES.map((c) => c.key) as [ListingCadence, ...ListingCadence[]];
const checkKeys = LISTING_CHECK_KEYS as [ListingCheck, ...ListingCheck[]];

export const listingWatchSchema = z
  .object({
    channelId: z.string().uuid("Choose a marketplace."),
    asin: z.string().trim(),
    checks: z.array(z.enum(checkKeys)).min(1, "Choose at least one thing to watch."),
    cadence: z.enum(cadenceKeys),
    notify: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const asin = normalizeAsin(value.asin);
    if (!asin) {
      ctx.addIssue({
        code: "custom",
        path: ["asin"],
        message: "Enter the 10-character ASIN from the product page. It looks like B0XXXXXXXX.",
      });
    }
    const issue = listingWatchIssue({ checks: value.checks, cadence: value.cadence });
    if (issue && asin) {
      ctx.addIssue({ code: "custom", path: ["cadence"], message: issue });
    }
  })
  .transform((value) => ({ ...value, asin: normalizeAsin(value.asin) as string }));

export type ListingWatchInput = z.input<typeof listingWatchSchema>;
