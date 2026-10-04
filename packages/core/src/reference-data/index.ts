import countriesJson from "./countries.json" with { type: "json" };
import currenciesJson from "./currencies.json" with { type: "json" };
import subdivisionsJson from "./subdivisions.json" with { type: "json" };

export type Country = { code: string; name: string; currency: string | null; timezones: string[] };
export type Subdivision = { code: string; countryCode: string; name: string };
export type Currency = { code: string; name: string; minorUnits: number };

export const countries: readonly Country[] = countriesJson;
export const subdivisions: readonly Subdivision[] = subdivisionsJson;
export const currencies: readonly Currency[] = currenciesJson;

const countryByCode = new Map(countries.map((c) => [c.code, c]));
const currencyByCode = new Map(currencies.map((c) => [c.code, c]));
const subdivisionByCode = new Map(subdivisions.map((s) => [s.code, s]));

export function getCountry(code: string): Country | undefined {
  return countryByCode.get(code);
}

export function getCurrency(code: string): Currency | undefined {
  return currencyByCode.get(code);
}

export function getSubdivision(code: string): Subdivision | undefined {
  return subdivisionByCode.get(code);
}

export function subdivisionsOf(countryCode: string): Subdivision[] {
  return subdivisions.filter((s) => s.countryCode === countryCode);
}
