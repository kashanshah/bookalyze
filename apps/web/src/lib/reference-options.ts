import { countries, currencies } from "@bookalyze/core/reference-data";
import type { CountryOption, CurrencyOption } from "@/components/org/profile-state";

/** Compact country/currency lists passed from server components to the profile form. */
export function referenceOptions(): { countries: CountryOption[]; currencies: CurrencyOption[] } {
  return {
    countries: countries.map((c) => ({
      code: c.code,
      name: c.name,
      currency: c.currency,
      timezones: c.timezones,
    })),
    currencies: currencies.map((c) => ({ code: c.code, name: c.name })),
  };
}
