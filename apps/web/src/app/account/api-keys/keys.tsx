"use client";

import { BookOpen, Copy, KeyRound, PencilLine, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceCards } from "@/components/ui/choice-card";
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
import { type CreateKeyInput, createApiKeyAction, revokeApiKeyAction } from "./actions";

type Company = { id: string; name: string; slug: string };
type Key = {
  id: string;
  name: string;
  prefix: string;
  access: "read" | "write";
  organizationIds: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

const day = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it.");
  }
}

function CopyBlock({ text, what }: { text: string; what: string }) {
  return (
    <div className="grid gap-2">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-xs leading-relaxed">
        {text}
      </pre>
      <Button size="sm" variant="outline" className="w-fit" onClick={() => copy(text, what)}>
        <Copy />
        Copy {what.toLowerCase()}
      </Button>
    </div>
  );
}

export function claudeCommand(origin: string, secret: string) {
  return `claude mcp add --transport http bookalyze ${origin}/api/mcp --header "Authorization: Bearer ${secret}"`;
}

export function ApiKeys({
  keys,
  companies,
  origin,
}: {
  keys: Key[];
  companies: Company[];
  origin: string;
}) {
  const [creating, setCreating] = useState(false);
  const live = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              Your keys
            </CardTitle>
            <CardDescription>
              Each key is shown once, when you make it. Keep it like a password.
            </CardDescription>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New key
          </Button>
        </CardHeader>
        <CardContent>
          {live.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <KeyRound className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">No keys yet</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Make one to connect Claude Code or a script to your books.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {live.map((k) => (
                <KeyRow key={k.id} apiKey={k} companyNames={nameOf} />
              ))}
            </ul>
          )}
          {revoked.length ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {revoked.length} revoked {revoked.length === 1 ? "key" : "keys"}
              </summary>
              <ul className="mt-2 grid gap-1 text-muted-foreground">
                {revoked.map((k) => (
                  <li key={k.id} className="flex flex-wrap gap-x-2">
                    <span className="line-through">{k.name}</span>
                    <span className="font-mono text-xs">{k.prefix}…</span>
                    <span>revoked {day(k.revokedAt ?? k.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-muted-foreground" />
            Connect Claude Code
          </CardTitle>
          <CardDescription>
            Make a key, then run this once in a terminal. Claude can then list your companies,
            categorise transactions, reconcile accounts and pull reports for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <CopyBlock text={claudeCommand(origin, "bka_your_key")} what="Command" />
          <p className="text-muted-foreground text-xs">
            Any MCP client works the same way: the server is <code>{origin}/api/mcp</code>{" "}
            (Streamable HTTP) with your key as a Bearer token. Scripts can use the REST API at{" "}
            <code>{origin}/api/v1</code>.
          </p>
        </CardContent>
      </Card>

      <CreateKeyDialog
        open={creating}
        onOpenChange={setCreating}
        companies={companies}
        origin={origin}
      />
    </>
  );
}

function KeyRow({ apiKey: k, companyNames }: { apiKey: Key; companyNames: Map<string, string> }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const expired = k.expiresAt ? new Date(k.expiresAt).getTime() < Date.now() : false;
  const companies =
    k.organizationIds === null
      ? "All your companies"
      : k.organizationIds.map((id) => companyNames.get(id) ?? "A company you left").join(", ");

  function revoke() {
    start(async () => {
      const result = await revokeApiKeyAction(k.id);
      if (result.ok) {
        toast.success(`“${k.name}” revoked. It stops working right away.`);
        router.refresh();
      } else toast.error(result.message ?? "Couldn't revoke the key.");
      setConfirming(false);
    });
  }

  return (
    <li className="fade-in-0 flex animate-in flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0">
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{k.name}</span>
          {k.access === "write" ? (
            <Badge variant="primary">
              <PencilLine className="size-3" />
              Read and write
            </Badge>
          ) : (
            <Badge variant="secondary">
              <ShieldCheck className="size-3" />
              Read only
            </Badge>
          )}
          {expired ? <Badge variant="destructive">Expired</Badge> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          <span className="font-mono">{k.prefix}…</span> · {companies}
        </p>
        <p className="text-muted-foreground text-xs">
          Made {day(k.createdAt)} · {k.lastUsedAt ? `Last used ${day(k.lastUsedAt)}` : "Never used"}{" "}
          · {k.expiresAt ? `${expired ? "Expired" : "Expires"} ${day(k.expiresAt)}` : "No expiry"}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Keep
          </Button>
          <Button size="sm" variant="destructive" onClick={revoke} disabled={pending}>
            {pending ? <Spinner /> : null}
            Revoke now
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          Revoke
        </Button>
      )}
    </li>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  companies,
  origin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Company[];
  origin: string;
}) {
  const router = useRouter();
  const blank: CreateKeyInput = {
    name: "",
    access: "read",
    companies: "all",
    organizationIds: [],
    expires: "90",
  };
  const [form, setForm] = useState<CreateKeyInput>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setForm(blank);
      setErrors({});
      setMessage(undefined);
      if (secret) router.refresh();
      setSecret(null);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await createApiKeyAction(form);
      if (!result.ok) {
        setErrors(result.errors ?? {});
        setMessage(result.message);
        return;
      }
      setSecret(result.secret);
      toast.success("Key made. Copy it now: it won't be shown again.");
    });
  }

  const chosen = new Set(form.organizationIds);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Your new key</DialogTitle>
              <DialogDescription>
                Copy it now and keep it somewhere safe. Bookalyze only keeps a fingerprint of it, so
                it can't be shown again.
              </DialogDescription>
            </DialogHeader>
            <CopyBlock text={secret} what="Key" />
            <div className="grid gap-2">
              <p className="font-medium text-sm">Connect Claude Code</p>
              <CopyBlock text={claudeCommand(origin, secret)} what="Command" />
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                The key acts as you. Give it only the access the job needs.
              </DialogDescription>
            </DialogHeader>
            {message ? <Alert variant="destructive">{message}</Alert> : null}
            <Field
              label="Name"
              htmlFor="key-name"
              hint="So you recognise it later."
              error={errors.name}
            >
              <Input
                id="key-name"
                value={form.name}
                maxLength={80}
                placeholder="Claude Code on my laptop"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </Field>
            <div className="grid gap-2">
              <p className="font-medium text-sm">What may it do?</p>
              <ChoiceCards
                name="access"
                value={form.access}
                onChange={(v) => setForm({ ...form, access: v as "read" | "write" })}
                choices={[
                  {
                    value: "read",
                    label: "Read only",
                    description: "See transactions, balances and reports. Change nothing.",
                    icon: <ShieldCheck />,
                  },
                  {
                    value: "write",
                    label: "Read and write",
                    description:
                      "Also add and categorise transactions, reconcile, upload statements.",
                    icon: <PencilLine />,
                  },
                ]}
              />
            </div>
            <div className="grid gap-2">
              <p className="font-medium text-sm">Which companies?</p>
              <ChoiceCards
                name="companies"
                value={form.companies}
                onChange={(v) => setForm({ ...form, companies: v as "all" | "chosen" })}
                choices={[
                  {
                    value: "all",
                    label: "All my companies",
                    description: "Including ones you join later.",
                  },
                  { value: "chosen", label: "Only some", description: "Pick them below." },
                ]}
              />
              {form.companies === "chosen" ? (
                <div className="fade-in-0 grid animate-in gap-2 rounded-xl border p-3">
                  {companies.map((c) => (
                    <div key={c.id} className="flex items-center gap-2.5 text-sm">
                      <Checkbox
                        label={c.name}
                        checked={chosen.has(c.id)}
                        onChange={() =>
                          setForm({
                            ...form,
                            organizationIds: chosen.has(c.id)
                              ? form.organizationIds.filter((id) => id !== c.id)
                              : [...form.organizationIds, c.id],
                          })
                        }
                      />
                      <span>{c.name}</span>
                    </div>
                  ))}
                  {errors.organizationIds ? (
                    <p className="text-destructive text-xs">{errors.organizationIds}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="grid gap-2">
              <p className="font-medium text-sm">When should it stop working?</p>
              <ChoiceCards
                name="expires"
                columns={4}
                value={form.expires}
                onChange={(v) => setForm({ ...form, expires: v as CreateKeyInput["expires"] })}
                choices={[
                  { value: "30", label: "30 days" },
                  { value: "90", label: "90 days" },
                  { value: "365", label: "1 year" },
                  { value: "never", label: "Never" },
                ]}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Make key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
