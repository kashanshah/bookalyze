"use client";

import { type IdentifierKind, identifierKind, JURISDICTIONS, PERSON_ROLES } from "@bookalyze/core";
import { Building2, Hash, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import {
  deleteIdentifierAction,
  deletePersonAction,
  type EntityResult,
  saveDetailsAction,
  saveIdentifierAction,
  savePersonAction,
} from "./actions";

export type ProfileView = {
  slug: string;
  locale: string;
  canEditDetails: boolean;
  country: string;
  legalName: string;
  tradeName: string | null;
  entityTypeLabel: string;
  fiscalYearEnd: string;
  incorporationDate: string | null;
  jurisdiction: string | null;
  registeredAddress: string | null;
  identifierKinds: IdentifierKind[];
  identifiers: {
    id: string;
    kind: string;
    label: string | null;
    value: string;
    expiresOn: string | null;
    notes: string | null;
  }[];
  people: {
    id: string;
    name: string;
    roles: string[];
    title: string | null;
    ownershipPercent: string | null;
    email: string | null;
    startDate: string | null;
    endDate: string | null;
    notes: string | null;
  }[];
};

/** Runs a save, shows field errors or a toast, and closes on success. */
function useSave(onDone: () => void) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = (task: () => Promise<EntityResult>, success: string) =>
    start(async () => {
      const result = await task();
      if (!result.ok) {
        setErrors(result.errors ?? {});
        if (result.message) toast.error(result.message);
        return;
      }
      setErrors({});
      toast.success(success);
      onDone();
    });
  return { pending, errors, save };
}

function Section({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-5 py-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line text-sm">{value || "—"}</dd>
    </div>
  );
}

export function ProfileScreen({ view }: { view: ProfileView }) {
  const [editingDetails, setEditingDetails] = useState(false);
  const [identifier, setIdentifier] = useState<ProfileView["identifiers"][number] | "new" | null>(
    null,
  );
  const [person, setPerson] = useState<ProfileView["people"][number] | "new" | null>(null);
  const [key, setKey] = useState(0);
  const open = <T,>(set: (v: T) => void, value: T) => {
    setKey((k) => k + 1);
    set(value);
  };
  const jurisdiction = JURISDICTIONS.find((j) => j.code === view.jurisdiction);
  const kindLabel = (i: ProfileView["identifiers"][number]) =>
    i.kind === "other" ? (i.label ?? "Other") : (identifierKind(i.kind)?.label ?? i.kind);
  const roleLabel = (r: string) => PERSON_ROLES.find((p) => p.key === r)?.label ?? r;

  return (
    <div className="grid gap-6">
      <Section
        icon={Building2}
        title="Company details"
        description="Who the company is legally, and where it's registered."
        action={
          view.canEditDetails ? (
            <Button variant="outline" size="sm" onClick={() => open(setEditingDetails, true)}>
              <Pencil />
              Edit
            </Button>
          ) : null
        }
      >
        <dl className="divide-y">
          <Row label="Legal name" value={view.legalName} />
          <Row label="Trade name" value={view.tradeName} />
          <Row label="Type of business" value={view.entityTypeLabel} />
          <Row label="Incorporated in" value={jurisdiction?.label} />
          <Row
            label="Date of incorporation"
            value={
              view.incorporationDate
                ? formatDate(view.incorporationDate, view.locale, "long")
                : null
            }
          />
          <Row label="Financial year ends" value={view.fiscalYearEnd} />
          <Row label="Registered address" value={view.registeredAddress} />
        </dl>
        <p className="border-t bg-muted/30 px-5 py-2.5 text-muted-foreground text-xs">
          Legal name, trade name, type and financial year are changed in Company settings.
        </p>
      </Section>

      <Section
        icon={Hash}
        title="Registration numbers"
        description="Business numbers, licenses and tax registrations. A license with an expiry date goes on the compliance calendar."
        action={
          <Button size="sm" onClick={() => open(setIdentifier, "new")}>
            <Plus />
            Add number
          </Button>
        }
      >
        {view.identifiers.length ? (
          <ul className="divide-y">
            {view.identifiers.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <button
                  type="button"
                  onClick={() => open(setIdentifier, i)}
                  className="min-w-0 flex-1 text-start"
                >
                  <p className="text-muted-foreground text-xs">{kindLabel(i)}</p>
                  <p className="tabular truncate font-medium">{i.value}</p>
                </button>
                {i.expiresOn ? (
                  <Badge variant="outline">Expires {formatDate(i.expiresOn, view.locale)}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            No numbers yet. Add the business number or trade license first.
          </p>
        )}
      </Section>

      <Section
        icon={UserRound}
        title="People"
        description="Directors, officers and owners, with their share and when they started."
        action={
          <Button size="sm" onClick={() => open(setPerson, "new")}>
            <Plus />
            Add person
          </Button>
        }
      >
        {view.people.length ? (
          <ul className="divide-y">
            {view.people.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => open(setPerson, p)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-start transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {p.name}
                      {p.title ? (
                        <span className="font-normal text-muted-foreground"> · {p.title}</span>
                      ) : null}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {p.roles.map((r) => (
                        <Badge key={r} variant="secondary">
                          {roleLabel(r)}
                        </Badge>
                      ))}
                      {p.endDate ? (
                        <Badge variant="outline">Left {formatDate(p.endDate, view.locale)}</Badge>
                      ) : null}
                    </span>
                  </span>
                  {p.ownershipPercent ? (
                    <span className="tabular font-medium text-sm">
                      {Number.parseFloat(p.ownershipPercent)}%
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            No one listed yet. Add the directors and owners.
          </p>
        )}
      </Section>

      <Dialog open={editingDetails} onOpenChange={setEditingDetails}>
        <DialogContent>
          {editingDetails ? (
            <DetailsForm key={key} view={view} onDone={() => setEditingDetails(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={identifier !== null} onOpenChange={(o) => (o ? null : setIdentifier(null))}>
        <DialogContent>
          {identifier ? (
            <IdentifierForm
              key={key}
              view={view}
              identifier={identifier === "new" ? null : identifier}
              onDone={() => setIdentifier(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={person !== null} onOpenChange={(o) => (o ? null : setPerson(null))}>
        <DialogContent className="sm:max-w-xl">
          {person ? (
            <PersonForm
              key={key}
              slug={view.slug}
              person={person === "new" ? null : person}
              onDone={() => setPerson(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailsForm({ view, onDone }: { view: ProfileView; onDone: () => void }) {
  const [jurisdiction, setJurisdiction] = useState(view.jurisdiction ?? "");
  const [incorporationDate, setIncorporationDate] = useState(view.incorporationDate ?? "");
  const [address, setAddress] = useState(view.registeredAddress ?? "");
  const { pending, errors, save } = useSave(onDone);
  const options = [
    ...JURISDICTIONS.filter((j) => j.country === view.country),
    ...JURISDICTIONS.filter((j) => j.country !== view.country),
  ];
  const hint = JURISDICTIONS.find((j) => j.code === jurisdiction)?.hint;
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save(
          () =>
            saveDetailsAction(view.slug, {
              jurisdiction,
              incorporationDate,
              registeredAddress: address,
            }),
          "Company details saved",
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Company details</DialogTitle>
        <DialogDescription>
          Where and when the company was incorporated sets which annual filings go on the calendar.
        </DialogDescription>
      </DialogHeader>
      <Field
        label="Where is it incorporated?"
        htmlFor="jurisdiction"
        error={errors.jurisdiction}
        hint={hint}
      >
        <Combobox
          id="jurisdiction"
          value={jurisdiction}
          onChange={setJurisdiction}
          placeholder="Choose a place…"
          options={options.map((j) => ({ value: j.code, label: j.label }))}
        />
      </Field>
      <Field
        label="Date of incorporation"
        htmlFor="incorporation-date"
        error={errors.incorporationDate}
        hint="The anniversary sets when the annual return is due."
      >
        <Input
          id="incorporation-date"
          type="date"
          value={incorporationDate}
          onChange={(e) => setIncorporationDate(e.target.value)}
        />
      </Field>
      <Field
        label="Registered address"
        htmlFor="registered-address"
        error={errors.registeredAddress}
      >
        <Textarea
          id="registered-address"
          rows={3}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function IdentifierForm({
  view,
  identifier,
  onDone,
}: {
  view: ProfileView;
  identifier: ProfileView["identifiers"][number] | null;
  onDone: () => void;
}) {
  const [kind, setKind] = useState(identifier?.kind ?? view.identifierKinds[0]?.key ?? "other");
  const [label, setLabel] = useState(identifier?.label ?? "");
  const [value, setValue] = useState(identifier?.value ?? "");
  const [expiresOn, setExpiresOn] = useState(identifier?.expiresOn ?? "");
  const [notes, setNotes] = useState(identifier?.notes ?? "");
  const { pending, errors, save } = useSave(onDone);
  const [removing, startRemove] = useTransition();
  const chosen = identifierKind(kind);
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save(
          () =>
            saveIdentifierAction(view.slug, {
              id: identifier?.id ?? "",
              kind,
              label: kind === "other" ? label : "",
              value,
              expiresOn: chosen?.expires ? expiresOn : "",
              notes,
            }),
          identifier ? "Number saved" : "Number added",
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {identifier ? "Registration number" : "Add a registration number"}
        </DialogTitle>
        <DialogDescription>Kept here so it's at hand when a form asks for it.</DialogDescription>
      </DialogHeader>
      <Field label="What is it?" htmlFor="identifier-kind" error={errors.kind} hint={chosen?.hint}>
        <Combobox
          id="identifier-kind"
          value={kind}
          onChange={setKind}
          options={view.identifierKinds.map((k) => ({ value: k.key, label: k.label }))}
        />
      </Field>
      {kind === "other" ? (
        <Field label="Name" htmlFor="identifier-label" error={errors.label}>
          <Input
            id="identifier-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Import/export code"
          />
        </Field>
      ) : null}
      <Field label="Number" htmlFor="identifier-value" error={errors.value}>
        <Input id="identifier-value" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {chosen?.expires ? (
        <Field
          label="Expires on (optional)"
          htmlFor="identifier-expires"
          error={errors.expiresOn}
          hint="You'll be reminded 30 days, 7 days and 1 day before."
        >
          <Input
            id="identifier-expires"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </Field>
      ) : null}
      <Field label="Notes (optional)" htmlFor="identifier-notes" error={errors.notes}>
        <Textarea
          id="identifier-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <DialogFooter className="sm:justify-between">
        {identifier ? (
          <Button
            type="button"
            variant="ghost"
            disabled={removing}
            onClick={() =>
              startRemove(async () => {
                const result = await deleteIdentifierAction(view.slug, identifier.id);
                if (!result.ok) return void toast.error(result.message);
                toast.success("Number removed");
                onDone();
              })
            }
          >
            {removing ? <Spinner /> : <Trash2 />}
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {identifier ? "Save" : "Add number"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function PersonForm({
  slug,
  person,
  onDone,
}: {
  slug: string;
  person: ProfileView["people"][number] | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(person?.name ?? "");
  const [roles, setRoles] = useState<string[]>(person?.roles ?? ["director"]);
  const [title, setTitle] = useState(person?.title ?? "");
  const [ownership, setOwnership] = useState(
    person?.ownershipPercent ? String(Number.parseFloat(person.ownershipPercent)) : "",
  );
  const [email, setEmail] = useState(person?.email ?? "");
  const [startDate, setStartDate] = useState(person?.startDate ?? "");
  const [endDate, setEndDate] = useState(person?.endDate ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const { pending, errors, save } = useSave(onDone);
  const [removing, startRemove] = useTransition();
  const toggle = (role: string) =>
    setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]));
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save(
          () =>
            savePersonAction(slug, {
              id: person?.id ?? "",
              name,
              roles,
              title,
              ownershipPercent: ownership,
              email,
              startDate,
              endDate,
              notes,
            }),
          person ? "Saved" : "Person added",
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>{person ? person.name : "Add a person"}</DialogTitle>
        <DialogDescription>
          Someone who directs, runs or owns the company. Keep past ones with an end date.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="person-name" error={errors.name}>
          <Input id="person-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Title (optional)" htmlFor="person-title" error={errors.title}>
          <Input
            id="person-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. President"
          />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium text-sm">Roles</legend>
        {PERSON_ROLES.map((r) => (
          // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox renders the input.
          <label key={r.key} className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox
              checked={roles.includes(r.key)}
              onChange={() => toggle(r.key)}
              label={r.label}
            />
            {r.label}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field
          label="Ownership (optional)"
          htmlFor="person-ownership"
          error={errors.ownershipPercent}
          hint="Their share of the company, in percent."
        >
          <Input
            id="person-ownership"
            inputMode="decimal"
            value={ownership}
            onChange={(e) => setOwnership(e.target.value)}
            placeholder="e.g. 50"
            className="tabular"
          />
        </Field>
        <Field label="Email (optional)" htmlFor="person-email" error={errors.email}>
          <Input
            id="person-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Started (optional)" htmlFor="person-start" error={errors.startDate}>
          <Input
            id="person-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Left (optional)" htmlFor="person-end" error={errors.endDate}>
          <Input
            id="person-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes (optional)" htmlFor="person-notes" error={errors.notes}>
        <Textarea
          id="person-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <DialogFooter className="sm:justify-between">
        {person ? (
          <Button
            type="button"
            variant="ghost"
            disabled={removing}
            onClick={() =>
              startRemove(async () => {
                const result = await deletePersonAction(slug, person.id);
                if (!result.ok) return void toast.error(result.message);
                toast.success("Removed");
                onDone();
              })
            }
          >
            {removing ? <Spinner /> : <Trash2 />}
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {person ? "Save" : "Add person"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
