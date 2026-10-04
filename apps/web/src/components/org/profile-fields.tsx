"use client";

import { fiscalYearFor } from "@bookalyze/core";
import {
  Briefcase,
  Building2,
  CalendarCheck2,
  CalendarDays,
  HandHeart,
  Store,
  User,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ChoiceCards } from "@/components/ui/choice-card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { localeLabel, timezoneLabel } from "@/lib/format";
import { type FieldErrors, LOCALE_OPTIONS } from "@/lib/validation/org-profile";
import type { CountryOption, CurrencyOption, ProfileState } from "./profile-state";

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const ENTITY_CHOICES = [
  {
    value: "corporation",
    label: "Corporation",
    description: "Incorporated company with shareholders, e.g. Inc., Ltd., Corp.",
    icon: <Building2 />,
  },
  {
    value: "sole_proprietorship",
    label: "Sole proprietorship",
    description: "Owned and run by one person, incl. sole establishments.",
    icon: <User />,
  },
  { value: "llc", label: "LLC", description: "Limited liability company.", icon: <Briefcase /> },
  {
    value: "partnership",
    label: "Partnership",
    description: "Two or more owners sharing the business.",
    icon: <Users />,
  },
  {
    value: "nonprofit",
    label: "Nonprofit",
    description: "Charity, society or not-for-profit.",
    icon: <HandHeart />,
  },
  {
    value: "other",
    label: "Something else",
    description: "Any other legal structure.",
    icon: <Store />,
  },
];

function daysIn(month: number) {
  return month === 2 ? 29 : new Date(Date.UTC(2001, month, 0)).getUTCDate();
}

export function EntityTypePicker({
  state,
  compact = false,
}: {
  state: ProfileState;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <NativeSelect
        id="entityType"
        name="entityType"
        value={state.entityType}
        onChange={(e) => state.setEntityType(e.target.value)}
      >
        {ENTITY_CHOICES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </NativeSelect>
    );
  }
  return (
    <ChoiceCards
      name="entityType"
      value={state.entityType}
      onChange={state.setEntityType}
      choices={ENTITY_CHOICES}
      columns={2}
    />
  );
}

export function LocationFields({
  state,
  countries,
  currencies,
  errors,
  currencyLocked = false,
}: {
  state: ProfileState;
  countries: CountryOption[];
  currencies: CurrencyOption[];
  errors?: FieldErrors | undefined;
  currencyLocked?: boolean;
}) {
  const country = countries.find((c) => c.code === state.countryCode);
  const allTimezones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const countryTimezones = country?.timezones ?? [];
  const otherTimezones = allTimezones.filter((tz) => !countryTimezones.includes(tz));
  // biome-ignore lint/correctness/useExhaustiveDependencies: the full zone list never changes at runtime
  const tzLabels = useMemo(
    () => new Map(allTimezones.concat(countryTimezones).map((tz) => [tz, timezoneLabel(tz)])),
    [countryTimezones],
  );
  const locales = Array.from(new Set([state.locale, `en-${state.countryCode}`, ...LOCALE_OPTIONS]));
  let preview = "";
  try {
    preview = `${new Intl.NumberFormat(state.locale, { style: "currency", currency: state.baseCurrency }).format(1234.5)}  ·  ${new Intl.DateTimeFormat(state.locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 11, 31)))}`;
  } catch {
    preview = "";
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Country" htmlFor="countryCode" error={errors?.countryCode}>
        <NativeSelect
          id="countryCode"
          name="countryCode"
          value={state.countryCode}
          onChange={(e) => state.changeCountry(e.target.value, { lockCurrency: currencyLocked })}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        label="Province, state or region"
        htmlFor="subdivisionCode"
        error={errors?.subdivisionCode}
      >
        <NativeSelect
          id="subdivisionCode"
          name="subdivisionCode"
          value={state.subdivisionCode}
          onChange={(e) => state.setSubdivisionCode(e.target.value)}
        >
          <option value="">{state.subdivisions.length ? "Choose one…" : "Not applicable"}</option>
          {state.subdivisions.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        label="Main currency"
        htmlFor="baseCurrency"
        hint={
          currencyLocked
            ? "Can't be changed once you have transactions."
            : "Your books and reports are kept in this currency. You can still use others."
        }
        error={errors?.baseCurrency}
      >
        <NativeSelect
          id="baseCurrency"
          name={currencyLocked ? undefined : "baseCurrency"}
          value={state.baseCurrency}
          onChange={(e) => state.setBaseCurrency(e.target.value)}
          disabled={currencyLocked}
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </NativeSelect>
        {currencyLocked ? (
          <input type="hidden" name="baseCurrency" value={state.baseCurrency} />
        ) : null}
      </Field>
      <Field
        label="Time zone"
        htmlFor="timezone"
        hint="Decides when your days and periods start and end."
        error={errors?.timezone}
      >
        <NativeSelect
          id="timezone"
          name="timezone"
          value={state.timezone}
          onChange={(e) => state.setTimezone(e.target.value)}
        >
          {countryTimezones.length ? (
            <optgroup label={country?.name ?? "Country"}>
              {countryTimezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tzLabels.get(tz)}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="All time zones">
            {otherTimezones.map((tz) => (
              <option key={tz} value={tz}>
                {tzLabels.get(tz)}
              </option>
            ))}
          </optgroup>
        </NativeSelect>
      </Field>
      <Field
        label="Number and date format"
        htmlFor="locale"
        className="sm:col-span-2"
        hint={preview ? <span className="tabular">Looks like: {preview}</span> : undefined}
        error={errors?.locale}
      >
        <NativeSelect
          id="locale"
          name="locale"
          value={state.locale}
          onChange={(e) => state.setLocale(e.target.value)}
        >
          {locales.map((l) => (
            <option key={l} value={l}>
              {localeLabel(l)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

const FY_PRESETS = [
  {
    value: "12-31",
    label: "January to December",
    description: "Calendar year. Most common.",
    icon: <CalendarDays />,
  },
  {
    value: "6-30",
    label: "July to June",
    description: "Common in Pakistan, Australia and others.",
    icon: <CalendarDays />,
  },
  {
    value: "3-31",
    label: "April to March",
    description: "Common in India, the UK and Japan.",
    icon: <CalendarDays />,
  },
  {
    value: "custom",
    label: "Something else",
    description: "Pick the exact day your year ends.",
    icon: <CalendarDays />,
  },
];

function todayIso() {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

export function FiscalYearFields({
  state,
  errors,
  showPreview = true,
}: {
  state: ProfileState;
  errors?: FieldErrors | undefined;
  showPreview?: boolean;
}) {
  const presetKey = `${state.fiscalYearEndMonth}-${state.fiscalYearEndDay}`;
  const matchesPreset = FY_PRESETS.some((p) => p.value === presetKey);
  const [customMode, setCustomMode] = useState(!matchesPreset);
  const preset = customMode || !matchesPreset ? "custom" : presetKey;
  const firstStart = state.firstFiscalYearStart || state.incorporationDate || null;
  let fy: ReturnType<typeof fiscalYearFor> | null = null;
  try {
    fy = fiscalYearFor(todayIso(), {
      endMonth: state.fiscalYearEndMonth,
      endDay: state.fiscalYearEndDay,
      firstFiscalYearStart: firstStart,
    });
  } catch {
    fy = null;
  }
  const fmt = (d: string) =>
    new Intl.DateTimeFormat(state.locale || "en-CA", { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(`${d}T00:00:00Z`),
    );

  return (
    <div className="grid gap-5">
      <ChoiceCards
        name="fyPreset"
        value={preset}
        columns={2}
        onChange={(v) => {
          if (v === "custom") return setCustomMode(true);
          setCustomMode(false);
          const [m, d] = v.split("-").map(Number);
          state.setFiscalYearEndMonth(m ?? 12);
          state.setFiscalYearEndDay(d ?? 31);
        }}
        choices={FY_PRESETS}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        {preset !== "custom" ? (
          <>
            <input type="hidden" name="fiscalYearEndMonth" value={state.fiscalYearEndMonth} />
            <input type="hidden" name="fiscalYearEndDay" value={state.fiscalYearEndDay} />
          </>
        ) : (
          <div className="fade-in-0 slide-in-from-top-1 grid animate-in grid-cols-[1fr_6rem] gap-3">
            <Field
              label="Year ends in"
              htmlFor="fiscalYearEndMonth"
              error={errors?.fiscalYearEndMonth}
            >
              <NativeSelect
                id="fiscalYearEndMonth"
                name="fiscalYearEndMonth"
                value={state.fiscalYearEndMonth}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  state.setFiscalYearEndMonth(m);
                  state.setFiscalYearEndDay(daysIn(m));
                }}
              >
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="On day" htmlFor="fiscalYearEndDay" error={errors?.fiscalYearEndDay}>
              <NativeSelect
                id="fiscalYearEndDay"
                name="fiscalYearEndDay"
                value={state.fiscalYearEndDay}
                onChange={(e) => state.setFiscalYearEndDay(Number(e.target.value))}
              >
                {Array.from({ length: daysIn(state.fiscalYearEndMonth) }, (_, i) => i + 1).map(
                  (d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ),
                )}
              </NativeSelect>
            </Field>
          </div>
        )}
        <Field
          label="First financial year started on"
          htmlFor="firstFiscalYearStart"
          hint="Only if the company started part-way through a year. Leave empty to use the registration date."
          error={errors?.firstFiscalYearStart}
        >
          <Input
            id="firstFiscalYearStart"
            name="firstFiscalYearStart"
            type="date"
            value={state.firstFiscalYearStart}
            onChange={(e) => state.setFirstFiscalYearStart(e.target.value)}
          />
        </Field>
      </div>
      {showPreview && fy ? (
        <div className="fade-in-0 flex animate-in items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarCheck2 className="size-[18px]" />
          </span>
          <div className="text-sm">
            <p className="font-medium">
              Your current financial year is {fy.label}
              {fy.isShortFirstYear ? " (a short first year)" : ""}
            </p>
            <p className="tabular mt-0.5 text-muted-foreground">
              {fmt(fy.start)} to {fmt(fy.end)}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
