"use client";

import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarRange,
  Check,
  ClipboardCheck,
  MapPin,
} from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  ENTITY_CHOICES,
  EntityTypePicker,
  FiscalYearFields,
  LocationFields,
  MONTHS,
} from "@/components/org/profile-fields";
import {
  type CountryOption,
  type CurrencyOption,
  useProfileState,
} from "@/components/org/profile-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { localeLabel, timezoneLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type CreateOrgState, createOrganizationAction } from "./actions";

const STEPS = [
  { title: "Your company", description: "Name and legal structure", icon: Building2 },
  { title: "Where you operate", description: "Location, currency and time zone", icon: MapPin },
  { title: "Financial year", description: "When your year starts and ends", icon: CalendarRange },
  { title: "Review", description: "Check everything and create", icon: ClipboardCheck },
] as const;

/** Which step holds each field, so server-side errors can send the user to the right place. */
const FIELD_STEP: Record<string, number> = {
  name: 0,
  legalName: 0,
  tradeName: 0,
  entityType: 0,
  incorporationDate: 0,
  countryCode: 1,
  subdivisionCode: 1,
  baseCurrency: 1,
  timezone: 1,
  locale: 1,
  fiscalYearEndMonth: 2,
  fiscalYearEndDay: 2,
  firstFiscalYearStart: 2,
};

export function OnboardingForm({
  countries,
  currencies,
}: {
  countries: CountryOption[];
  currencies: CurrencyOption[];
}) {
  const [state, action, pending] = useActionState<CreateOrgState, FormData>(
    createOrganizationAction,
    {},
  );
  const profile = useProfileState({}, countries);
  const [name, setName] = useState("");
  const [legalTouched, setLegalTouched] = useState(false);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errors = { ...state.errors, ...localErrors };

  // Jump to the first step with a server-side error.
  useEffect(() => {
    const keys = Object.keys(state.errors ?? {});
    if (keys.length) setStep(Math.min(...keys.map((k) => FIELD_STEP[k] ?? 0)));
  }, [state.errors]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: move focus to the heading whenever the step changes
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  function go(to: number) {
    if (to > step) {
      const errs: Record<string, string> = {};
      if (step === 0) {
        if (name.trim().length < 2) errs.name = "Give your company a name.";
        if (profile.legalName.trim().length < 2)
          errs.legalName = "Enter the registered legal name.";
      }
      setLocalErrors(errs);
      if (Object.keys(errs).length) return;
    }
    setDirection(to > step ? 1 : -1);
    setStep(to);
  }

  const country = countries.find((c) => c.code === profile.countryCode);
  const region = profile.subdivisions.find((s) => s.code === profile.subdivisionCode);
  const entity = ENTITY_CHOICES.find((c) => c.value === profile.entityType);
  const current = STEPS[step] ?? STEPS[0];

  return (
    <form
      action={action}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          step < STEPS.length - 1 &&
          (e.target as HTMLElement).tagName === "INPUT"
        ) {
          e.preventDefault();
          go(step + 1);
        }
      }}
      className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12"
    >
      {/* Progress */}
      <ol className="flex gap-2 lg:flex-col lg:gap-1" aria-label="Setup steps">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.title} className="flex-1 lg:flex-none">
              <button
                type="button"
                onClick={() => (i < step ? go(i) : undefined)}
                disabled={i > step}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "group flex w-full flex-col gap-2 rounded-xl text-start transition-colors lg:flex-row lg:items-center lg:gap-3 lg:p-2.5",
                  active && "lg:bg-card lg:shadow-xs lg:ring-1 lg:ring-border",
                  i < step && "cursor-pointer lg:hover:bg-card/70",
                )}
              >
                <span
                  className={cn(
                    "h-1 w-full rounded-full bg-border transition-colors duration-500 lg:hidden",
                    (done || active) && "bg-primary",
                  )}
                />
                <span
                  className={cn(
                    "hidden size-8 shrink-0 items-center justify-center rounded-full border font-medium text-xs transition-all duration-300 lg:flex",
                    done && "border-primary bg-primary text-primary-foreground",
                    active && "border-primary text-primary ring-4 ring-primary/10",
                    !done && !active && "text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-4" strokeWidth={2.5} /> : i + 1}
                </span>
                <span className="hidden min-w-0 lg:block">
                  <span
                    className={cn(
                      "block font-medium text-sm",
                      !active && !done && "text-muted-foreground",
                    )}
                  >
                    {s.title}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {s.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="min-w-0">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <current.icon className="size-5" />
          </span>
          <div>
            <p className="text-muted-foreground text-xs">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="font-semibold text-xl tracking-tight outline-none"
            >
              {current.title}
            </h2>
          </div>
        </div>

        {state.message ? (
          <Alert variant="destructive" className="mb-6">
            {state.message}
          </Alert>
        ) : null}

        <div className="relative">
          {/* All steps stay mounted (hidden) so every field is submitted with the form. */}
          <section
            hidden={step !== 0}
            className={cn(
              "grid gap-6",
              step === 0 && (direction === 1 ? "slide-in-from-right-4" : "slide-in-from-left-4"),
              "fade-in-0 animate-in duration-300",
            )}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="What do you call this company?"
                htmlFor="name"
                hint="Shown across Bookalyze, e.g. Kazomo Inc."
                error={errors.name}
              >
                <Input
                  id="name"
                  name="name"
                  autoFocus
                  value={name}
                  aria-invalid={Boolean(errors.name)}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!legalTouched) profile.setLegalName(e.target.value);
                  }}
                />
              </Field>
              <Field
                label="Registered legal name"
                htmlFor="legalName"
                hint="Exactly as on your registration documents."
                error={errors.legalName}
              >
                <Input
                  id="legalName"
                  name="legalName"
                  value={profile.legalName}
                  aria-invalid={Boolean(errors.legalName)}
                  onChange={(e) => {
                    setLegalTouched(true);
                    profile.setLegalName(e.target.value);
                  }}
                />
              </Field>
            </div>
            <div className="grid gap-3">
              <p className="font-medium text-sm">What kind of business is it?</p>
              <EntityTypePicker state={profile} />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Registration date (optional)"
                htmlFor="incorporationDate"
                hint="Used to work out your first financial year."
                error={errors.incorporationDate}
              >
                <Input
                  id="incorporationDate"
                  name="incorporationDate"
                  type="date"
                  value={profile.incorporationDate}
                  onChange={(e) => profile.setIncorporationDate(e.target.value)}
                />
              </Field>
              <Field
                label="Trade name (optional)"
                htmlFor="tradeName"
                hint="If you sell under a different name."
                error={errors.tradeName}
              >
                <Input
                  id="tradeName"
                  name="tradeName"
                  value={profile.tradeName}
                  onChange={(e) => profile.setTradeName(e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section
            hidden={step !== 1}
            className={cn(
              "grid gap-6",
              step === 1 && (direction === 1 ? "slide-in-from-right-4" : "slide-in-from-left-4"),
              "fade-in-0 animate-in duration-300",
            )}
          >
            <p className="text-muted-foreground text-sm">
              We'll suggest sensible defaults for your country. Tax rates for your region come
              later, when you set up accounting.
            </p>
            <LocationFields
              state={profile}
              countries={countries}
              currencies={currencies}
              errors={errors}
            />
          </section>

          <section
            hidden={step !== 2}
            className={cn(
              "grid gap-6",
              step === 2 && (direction === 1 ? "slide-in-from-right-4" : "slide-in-from-left-4"),
              "fade-in-0 animate-in duration-300",
            )}
          >
            <p className="text-muted-foreground text-sm">
              Your financial (fiscal) year is the 12-month period your reports and taxes are based
              on.
            </p>
            <FiscalYearFields state={profile} errors={errors} />
          </section>

          <section
            hidden={step !== 3}
            className={cn(
              "grid gap-4",
              step === 3 && "slide-in-from-right-4 fade-in-0 animate-in duration-300",
            )}
          >
            <ReviewRow title="Company" onEdit={() => go(0)}>
              <p className="font-medium">{name || "—"}</p>
              <p className="text-muted-foreground">
                {profile.legalName}
                {entity ? ` · ${entity.label}` : ""}
                {profile.incorporationDate ? ` · registered ${profile.incorporationDate}` : ""}
              </p>
            </ReviewRow>
            <ReviewRow title="Location & currency" onEdit={() => go(1)}>
              <p className="font-medium">
                {[region?.name, country?.name].filter(Boolean).join(", ")}
              </p>
              <p className="text-muted-foreground">
                {profile.baseCurrency} · {timezoneLabel(profile.timezone)} ·{" "}
                {localeLabel(profile.locale)}
              </p>
            </ReviewRow>
            <ReviewRow title="Financial year" onEdit={() => go(2)}>
              <p className="font-medium">
                Ends {profile.fiscalYearEndDay} {MONTHS[profile.fiscalYearEndMonth - 1]} each year
              </p>
              {profile.firstFiscalYearStart || profile.incorporationDate ? (
                <p className="text-muted-foreground">
                  First year starts {profile.firstFiscalYearStart || profile.incorporationDate}
                </p>
              ) : null}
            </ReviewRow>
            <p className="text-muted-foreground text-xs">
              You can change any of this later in Settings.
            </p>
          </section>
        </div>

        <div className="mt-8 flex items-center justify-between gap-3 border-t pt-6">
          <Button
            type="button"
            variant="ghost"
            onClick={() => go(step - 1)}
            className={cn(step === 0 && "invisible")}
          >
            <ArrowLeft className="rtl:rotate-180" />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            // Distinct keys stop React from reusing this element as the submit button mid-click,
            // which would submit the form when advancing to the review step.
            <Button
              key="continue"
              type="button"
              size="lg"
              onClick={(e) => {
                e.preventDefault();
                go(step + 1);
              }}
            >
              Continue
              <ArrowRight className="rtl:rotate-180" />
            </Button>
          ) : (
            <Button key="submit" type="submit" size="lg" disabled={pending}>
              {pending ? <Spinner /> : <Check />}
              {pending ? "Creating…" : "Create company"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

function ReviewRow({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border bg-card p-4 text-sm shadow-xs">
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-muted-foreground text-xs">{title}</p>
        {children}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}
