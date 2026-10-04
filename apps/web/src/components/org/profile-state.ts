"use client";

import { useCallback, useEffect, useState } from "react";

export type CountryOption = {
  code: string;
  name: string;
  currency: string | null;
  timezones: string[];
};
export type CurrencyOption = { code: string; name: string };

export type ProfileDefaults = {
  legalName?: string;
  tradeName?: string | null;
  entityType?: string;
  countryCode?: string;
  subdivisionCode?: string | null;
  baseCurrency?: string;
  timezone?: string;
  locale?: string;
  fiscalYearEndMonth?: number;
  fiscalYearEndDay?: number;
  incorporationDate?: string | null;
  firstFiscalYearStart?: string | null;
};

const PREFERRED_TIMEZONE: Record<string, string> = {
  CA: "America/Toronto",
  US: "America/New_York",
  AU: "Australia/Sydney",
  GB: "Europe/London",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  DE: "Europe/Berlin",
  ES: "Europe/Madrid",
};

/** Controlled state for the organization profile, shared by onboarding and settings. */
export function useProfileState(defaults: ProfileDefaults, countries: CountryOption[]) {
  const [legalName, setLegalName] = useState(defaults.legalName ?? "");
  const [tradeName, setTradeName] = useState(defaults.tradeName ?? "");
  const [entityType, setEntityType] = useState(defaults.entityType ?? "corporation");
  const [incorporationDate, setIncorporationDate] = useState(defaults.incorporationDate ?? "");
  const [countryCode, setCountryCode] = useState(defaults.countryCode ?? "CA");
  const [subdivisionCode, setSubdivisionCode] = useState(defaults.subdivisionCode ?? "");
  const [baseCurrency, setBaseCurrency] = useState(defaults.baseCurrency ?? "CAD");
  const [timezone, setTimezone] = useState(defaults.timezone ?? "America/Toronto");
  const [locale, setLocale] = useState(defaults.locale ?? "en-CA");
  const [fiscalYearEndMonth, setFiscalYearEndMonth] = useState(defaults.fiscalYearEndMonth ?? 12);
  const [fiscalYearEndDay, setFiscalYearEndDay] = useState(defaults.fiscalYearEndDay ?? 31);
  const [firstFiscalYearStart, setFirstFiscalYearStart] = useState(
    defaults.firstFiscalYearStart ?? "",
  );
  const [subdivisions, setSubdivisions] = useState<{ code: string; name: string }[]>([]);
  // Changed through a picker (searchable dropdowns don't fire a form's native change event).
  const [touched, setTouched] = useState(false);
  const clearTouched = useCallback(() => setTouched(false), []);
  const touching =
    <T>(set: (value: T) => void) =>
    (value: T) => {
      setTouched(true);
      set(value);
    };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reference/subdivisions?country=${countryCode}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { code: string; name: string }[]) => {
        if (!cancelled) setSubdivisions(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  function changeCountry(code: string, { lockCurrency = false } = {}) {
    setTouched(true);
    setCountryCode(code);
    setSubdivisionCode("");
    const info = countries.find((c) => c.code === code);
    if (!info) return;
    if (!lockCurrency && info.currency) setBaseCurrency(info.currency);
    setTimezone(PREFERRED_TIMEZONE[code] ?? info.timezones[0] ?? "UTC");
    setLocale(`en-${code}`);
  }

  return {
    legalName,
    setLegalName,
    tradeName,
    setTradeName,
    touched,
    clearTouched,
    entityType,
    setEntityType: touching(setEntityType),
    incorporationDate,
    setIncorporationDate,
    countryCode,
    changeCountry,
    subdivisionCode,
    setSubdivisionCode: touching(setSubdivisionCode),
    subdivisions,
    baseCurrency,
    setBaseCurrency: touching(setBaseCurrency),
    timezone,
    setTimezone: touching(setTimezone),
    locale,
    setLocale: touching(setLocale),
    fiscalYearEndMonth,
    setFiscalYearEndMonth: touching(setFiscalYearEndMonth),
    fiscalYearEndDay,
    setFiscalYearEndDay: touching(setFiscalYearEndDay),
    firstFiscalYearStart,
    setFirstFiscalYearStart,
  };
}

export type ProfileState = ReturnType<typeof useProfileState>;
