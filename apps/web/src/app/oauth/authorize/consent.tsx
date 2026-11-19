"use client";

import { Bot, CornerDownLeft, PencilLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceCards } from "@/components/ui/choice-card";
import { Spinner } from "@/components/ui/spinner";
import type { AuthorizeParams } from "@/server/oauth-request";
import { approveAction, type ConsentChoice, type ConsentResult, denyAction } from "./actions";

export function Consent({
  params,
  appName,
  returnsTo,
  email,
  wantsWrite,
  companies,
}: {
  params: AuthorizeParams;
  appName: string;
  returnsTo: string;
  email: string;
  wantsWrite: boolean;
  companies: { id: string; name: string }[];
}) {
  const [choice, setChoice] = useState<ConsentChoice>({
    access: wantsWrite ? "write" : "read",
    companies: "all",
    organizationIds: [],
    lifetime: "90",
  });
  const [message, setMessage] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const chosen = new Set(choice.organizationIds);

  function finish(result: ConsentResult) {
    if (result.ok) {
      setLeaving(true);
      window.location.assign(result.redirect);
      return;
    }
    setErrors(result.errors ?? {});
    setMessage(result.message);
  }

  return (
    <Card>
      <CardHeader className="grid gap-4">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="size-6" />
        </span>
        <div className="grid gap-1.5">
          <h1 className="text-balance font-semibold text-2xl tracking-tight">
            Connect “{appName}” to your books?
          </h1>
          <p className="text-muted-foreground text-sm">
            It will act as you ({email}), with your role in each company, and never more. You can
            disconnect it at any time in Account → API keys.
          </p>
        </div>
        <div className="grid gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
          <p className="flex items-start gap-2">
            <CornerDownLeft className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              After this, you'll go back to <span className="font-medium">{returnsTo}</span>.
            </span>
          </p>
          <p className="flex items-start gap-2 text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              The app named itself. Only continue if you just started connecting it, for example
              from Claude Code.
            </span>
          </p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {message ? <Alert variant="destructive">{message}</Alert> : null}
        <div className="grid gap-2">
          <p className="font-medium text-sm">What may it do?</p>
          <ChoiceCards
            name="access"
            value={choice.access}
            onChange={(v) => setChoice({ ...choice, access: v as "read" | "write" })}
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
                description: "Also add and categorise transactions, reconcile, upload statements.",
                icon: <PencilLine />,
              },
            ]}
          />
        </div>
        <div className="grid gap-2">
          <p className="font-medium text-sm">Which companies?</p>
          <ChoiceCards
            name="companies"
            value={choice.companies}
            onChange={(v) => setChoice({ ...choice, companies: v as "all" | "chosen" })}
            choices={[
              {
                value: "all",
                label: "All my companies",
                description: "Including ones you join later.",
              },
              { value: "chosen", label: "Only some", description: "Pick them below." },
            ]}
          />
          {choice.companies === "chosen" ? (
            <div className="fade-in-0 grid animate-in gap-2 rounded-xl border p-3">
              {companies.map((c) => (
                <div key={c.id} className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    label={c.name}
                    checked={chosen.has(c.id)}
                    onChange={() =>
                      setChoice({
                        ...choice,
                        organizationIds: chosen.has(c.id)
                          ? choice.organizationIds.filter((id) => id !== c.id)
                          : [...choice.organizationIds, c.id],
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
          <p className="font-medium text-sm">How long?</p>
          <ChoiceCards
            name="lifetime"
            columns={4}
            value={choice.lifetime}
            onChange={(v) => setChoice({ ...choice, lifetime: v as ConsentChoice["lifetime"] })}
            choices={[
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
              { value: "365", label: "1 year" },
              { value: "never", label: "Until I disconnect" },
            ]}
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          disabled={pending || leaving}
          onClick={() => start(async () => finish(await denyAction(params)))}
        >
          Cancel
        </Button>
        <Button
          disabled={pending || leaving}
          onClick={() => start(async () => finish(await approveAction(params, choice)))}
        >
          {pending || leaving ? <Spinner /> : null}
          Allow access
        </Button>
      </CardFooter>
    </Card>
  );
}
