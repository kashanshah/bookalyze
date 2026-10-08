/**
 * Noon (noon.com) reference data. A Noon seller account sells in one or more countries; each is
 * a channel of its own, in that country's currency. Orders are fulfilled by Noon from its
 * warehouses (FBN, like Amazon's FBA), shipped by the seller (FBP), or both.
 */

export type NoonMarketplace = {
  /** Our key for it, kept as the channel's `marketplace_id`. */
  id: string;
  name: string;
  country: string;
  currency: string;
};

const NOON_UAE: NoonMarketplace = {
  id: "noon-ae",
  name: "Noon UAE",
  country: "AE",
  currency: "AED",
};

export const NOON_MARKETPLACES: readonly NoonMarketplace[] = [
  NOON_UAE,
  { id: "noon-sa", name: "Noon KSA", country: "SA", currency: "SAR" },
  { id: "noon-eg", name: "Noon Egypt", country: "EG", currency: "EGP" },
];

export const noonMarketplace = (id: string) => NOON_MARKETPLACES.find((m) => m.id === id) ?? null;

/** Who ships a channel's orders: the marketplace (FBN, FBA), the seller (FBP, FBM), or both. */
export const FULFILMENT_MODES = ["marketplace", "seller", "both"] as const;
export type FulfilmentMode = (typeof FULFILMENT_MODES)[number];

export const isFulfilmentMode = (value: string): value is FulfilmentMode =>
  (FULFILMENT_MODES as readonly string[]).includes(value);

export const NOON_FULFILMENT: Record<FulfilmentMode, { label: string; hint: string }> = {
  marketplace: {
    label: "Fulfilled by Noon (FBN)",
    hint: "Your stock is in Noon's warehouses and Noon ships the orders.",
  },
  seller: {
    label: "Fulfilled by you (FBP)",
    hint: "Your stock stays with you, and you or your courier ship the orders.",
  },
  both: {
    label: "Both",
    hint: "Some listings are in Noon's warehouses, others you ship yourself.",
  },
};

/** The Noon marketplace for a company's country, else the UAE (where most Noon sellers are). */
export function defaultNoonMarketplace(countryCode: string | null | undefined): NoonMarketplace {
  return NOON_MARKETPLACES.find((m) => m.country === countryCode?.toUpperCase()) ?? NOON_UAE;
}
