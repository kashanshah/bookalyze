import type { FulfilmentMode } from "./noon";

/**
 * Walmart Marketplace reference data. A Walmart seller account sells in one or more countries
 * (Walmart's "markets"); each is a channel of its own, in that country's currency. Orders are
 * shipped by the seller, by Walmart Fulfillment Services (WFS, like Amazon's FBA), or both.
 */

export type WalmartMarketplace = {
  /** Our key for it, kept as the channel's `marketplace_id`. */
  id: string;
  name: string;
  country: string;
  currency: string;
  /** Walmart's market code, sent as the `WM_MARKET` header on API calls. */
  market: string;
  /** The site buyers shop on. */
  site: string;
};

const WALMART_US: WalmartMarketplace = {
  id: "walmart-us",
  name: "Walmart US",
  country: "US",
  currency: "USD",
  market: "us",
  site: "walmart.com",
};

export const WALMART_MARKETPLACES: readonly WalmartMarketplace[] = [
  WALMART_US,
  {
    id: "walmart-ca",
    name: "Walmart Canada",
    country: "CA",
    currency: "CAD",
    market: "ca",
    site: "walmart.ca",
  },
  {
    id: "walmart-mx",
    name: "Walmart Mexico",
    country: "MX",
    currency: "MXN",
    market: "mx",
    site: "walmart.com.mx",
  },
];

export const walmartMarketplace = (id: string) =>
  WALMART_MARKETPLACES.find((m) => m.id === id) ?? null;

/** The Walmart marketplace for a company's country, else Walmart US (the largest). */
export function defaultWalmartMarketplace(
  countryCode: string | null | undefined,
): WalmartMarketplace {
  return WALMART_MARKETPLACES.find((m) => m.country === countryCode?.toUpperCase()) ?? WALMART_US;
}

export const WALMART_FULFILMENT: Record<FulfilmentMode, { label: string; hint: string }> = {
  marketplace: {
    label: "Walmart Fulfillment Services (WFS)",
    hint: "Your stock is in Walmart's warehouses and Walmart ships the orders.",
  },
  seller: {
    label: "Fulfilled by you",
    hint: "Your stock stays with you, and you or your courier ship the orders.",
  },
  both: {
    label: "Both",
    hint: "Some listings are in Walmart's warehouses, others you ship yourself.",
  },
};
