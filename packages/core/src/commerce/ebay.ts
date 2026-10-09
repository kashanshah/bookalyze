/**
 * eBay reference data. One eBay seller account lists on one or more eBay sites; each site is a
 * channel of its own, in that site's currency. The ids are eBay's own marketplace ids (EBAY_US…),
 * the ones its APIs use, so orders and payouts brought in later find their channel by them.
 * The seller ships eBay orders.
 */

export type EbayMarketplace = {
  /** eBay's marketplace id, kept as the channel's `marketplace_id`. */
  id: string;
  name: string;
  country: string;
  currency: string;
  /** The site buyers shop on. */
  site: string;
};

const EBAY_US: EbayMarketplace = {
  id: "EBAY_US",
  name: "eBay US",
  country: "US",
  currency: "USD",
  site: "ebay.com",
};

export const EBAY_MARKETPLACES: readonly EbayMarketplace[] = [
  EBAY_US,
  { id: "EBAY_CA", name: "eBay Canada", country: "CA", currency: "CAD", site: "ebay.ca" },
  { id: "EBAY_GB", name: "eBay UK", country: "GB", currency: "GBP", site: "ebay.co.uk" },
  { id: "EBAY_AU", name: "eBay Australia", country: "AU", currency: "AUD", site: "ebay.com.au" },
  { id: "EBAY_DE", name: "eBay Germany", country: "DE", currency: "EUR", site: "ebay.de" },
  { id: "EBAY_FR", name: "eBay France", country: "FR", currency: "EUR", site: "ebay.fr" },
  { id: "EBAY_IT", name: "eBay Italy", country: "IT", currency: "EUR", site: "ebay.it" },
  { id: "EBAY_ES", name: "eBay Spain", country: "ES", currency: "EUR", site: "ebay.es" },
];

export const ebayMarketplace = (id: string) => EBAY_MARKETPLACES.find((m) => m.id === id) ?? null;

/** The eBay site for a company's country, else eBay US (the largest). */
export function defaultEbayMarketplace(countryCode: string | null | undefined): EbayMarketplace {
  return EBAY_MARKETPLACES.find((m) => m.country === countryCode?.toUpperCase()) ?? EBAY_US;
}
