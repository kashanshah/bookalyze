"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  EntityTypePicker,
  FiscalYearFields,
  LocationFields,
} from "@/components/org/profile-fields";
import {
  type CountryOption,
  type CurrencyOption,
  type ProfileDefaults,
  useProfileState,
} from "@/components/org/profile-state";
import { SettingsSection } from "@/components/shell/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type ProfileState, updateProfileAction } from "./actions";

type FormProps = {
  slug: string;
  name: string;
  profile: ProfileDefaults;
  canEdit: boolean;
  currencyLocked: boolean;
  countries: CountryOption[];
  currencies: CurrencyOption[];
};

/** Remounting the form on "Discard" resets every field to the saved values. */
export function GeneralSettingsForm(props: FormProps) {
  const [version, setVersion] = useState(0);
  return <SettingsForm key={version} {...props} onDiscard={() => setVersion((v) => v + 1)} />;
}

function SettingsForm({
  onDiscard,
  slug,
  name,
  profile,
  canEdit,
  currencyLocked,
  countries,
  currencies,
}: FormProps & { onDiscard: () => void }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(
    updateProfileAction.bind(null, slug),
    {},
  );
  const fields = useProfileState(profile, countries);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.saved) {
      toast.success("Company settings saved");
      setDirty(false);
    } else if (state.message) {
      toast.error(state.message);
    } else if (state.errors && Object.keys(state.errors).length) {
      toast.error("Please fix the highlighted fields");
    }
  }, [state]);

  return (
    <form action={action} onChange={() => setDirty(true)} className="pb-24">
      {!canEdit ? (
        <Alert className="mb-6">Only owners and admins can change these settings.</Alert>
      ) : null}
      <fieldset disabled={!canEdit || pending} className="divide-y">
        <SettingsSection title="Company" description="How this company is named and structured.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Display name"
              htmlFor="name"
              hint="Shown across Bookalyze."
              error={state.errors?.name}
            >
              <Input id="name" name="name" required defaultValue={name} />
            </Field>
            <Field
              label="Registered legal name"
              htmlFor="legalName"
              error={state.errors?.legalName}
            >
              <Input
                id="legalName"
                name="legalName"
                required
                value={fields.legalName}
                onChange={(e) => fields.setLegalName(e.target.value)}
              />
            </Field>
            <Field
              label="Trade name (optional)"
              htmlFor="tradeName"
              error={state.errors?.tradeName}
            >
              <Input
                id="tradeName"
                name="tradeName"
                value={fields.tradeName}
                onChange={(e) => fields.setTradeName(e.target.value)}
              />
            </Field>
            <Field label="Business type" htmlFor="entityType" error={state.errors?.entityType}>
              <EntityTypePicker state={fields} compact />
            </Field>
            <Field
              label="Registration date"
              htmlFor="incorporationDate"
              error={state.errors?.incorporationDate}
            >
              <Input
                id="incorporationDate"
                name="incorporationDate"
                type="date"
                value={fields.incorporationDate}
                onChange={(e) => fields.setIncorporationDate(e.target.value)}
              />
            </Field>
          </div>
        </SettingsSection>
        <SettingsSection
          title="Location & currency"
          description="Sets your default taxes, time zone and how numbers and dates appear."
        >
          <LocationFields
            state={fields}
            countries={countries}
            currencies={currencies}
            errors={state.errors}
            currencyLocked={currencyLocked}
          />
        </SettingsSection>
        <SettingsSection
          title="Financial year"
          description="The 12-month period your reports and taxes are based on. Changing it re-slices reports; nothing is lost."
        >
          <FiscalYearFields state={fields} errors={state.errors} />
        </SettingsSection>
      </fieldset>

      {/* Unsaved-changes bar */}
      <div
        aria-hidden={!dirty}
        className={`fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4 transition-all duration-300 ease-out lg:ps-[264px] ${
          dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        }`}
      >
        <div className="flex w-full max-w-xl items-center gap-3 rounded-2xl border bg-card/95 p-2 ps-4 shadow-2xl shadow-black/10 backdrop-blur">
          <span className="flex-1 text-sm">You have unsaved changes</span>
          <Button type="button" variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            Save changes
          </Button>
        </div>
      </div>
    </form>
  );
}
