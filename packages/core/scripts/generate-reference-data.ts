/**
 * Generates the committed reference data JSON (countries, subdivisions, currencies)
 * from open datasets. Re-run when the upstream packages update:
 *   pnpm --filter @bookalyze/core generate:reference
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Country, State } from "country-state-city";
import cc from "currency-codes";

const outDir = join(import.meta.dirname, "../src/reference-data");

const currencies = cc
  .codes()
  .map((code) => {
    const c = cc.code(code);
    if (!c) throw new Error(`Unknown currency ${code}`);
    return { code: c.code, name: c.currency, minorUnits: c.digits };
  })
  // Fund codes and precious metals have no real minor unit and are not used for bookkeeping.
  .filter(
    (c) =>
      !/^X[A-Z]{2}$/.test(c.code) ||
      c.code === "XAF" ||
      c.code === "XOF" ||
      c.code === "XCD" ||
      c.code === "XPF",
  )
  .sort((a, b) => a.code.localeCompare(b.code));

const knownCurrencies = new Set(currencies.map((c) => c.code));

const countries = Country.getAllCountries()
  .map((c) => ({
    code: c.isoCode,
    name: c.name,
    currency: knownCurrencies.has(c.currency) ? c.currency : null,
    timezones: [...new Set((c.timezones ?? []).map((t) => t.zoneName))].sort(),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const subdivisions = State.getAllStates()
  .map((s) => ({
    code: `${s.countryCode}-${s.isoCode}`,
    countryCode: s.countryCode,
    name: s.name,
  }))
  .sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.name.localeCompare(b.name));

// A handful of upstream rows share a code; keep the first so codes stay unique.
const seen = new Set<string>();
const uniqueSubdivisions = subdivisions.filter((s) =>
  seen.has(s.code) ? false : seen.add(s.code),
);

writeFileSync(join(outDir, "currencies.json"), `${JSON.stringify(currencies)}\n`);
writeFileSync(join(outDir, "countries.json"), `${JSON.stringify(countries)}\n`);
writeFileSync(join(outDir, "subdivisions.json"), `${JSON.stringify(uniqueSubdivisions)}\n`);

console.info(
  `Wrote ${currencies.length} currencies, ${countries.length} countries, ${uniqueSubdivisions.length} subdivisions`,
);
