import { getDb, listApiKeys } from "@bookalyze/db";
import { ArrowRight, Bot, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SITE_URL } from "@/lib/site";
import { listUserOrgs } from "@/server/org";
import { requireSession } from "@/server/session";
import { ApiKeys } from "./keys";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const session = await requireSession("/account/api-keys");
  const [keys, orgs] = await Promise.all([
    listApiKeys(getDb(), session.user.id),
    listUserOrgs(session.user.id),
  ]);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "app.bookalyze.com";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  return (
    <>
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="size-6" />
        </span>
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">API keys</h1>
          <p className="mt-1 max-w-xl text-muted-foreground text-sm">
            Let AI agents like Claude Code, and your own scripts, read and update your books without
            the browser. A connected app or key acts as you, with your role in each company, and
            never more: it can be read-only, limited to some companies, and revoked at any time.
          </p>
        </div>
      </div>
      <Link
        href="/account/ai-assistants"
        className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm shadow-xs transition-colors hover:bg-accent"
      >
        <Sparkles className="size-4 shrink-0 text-primary" />
        <span className="flex-1">
          <span className="font-medium">Connecting ChatGPT, Claude or Gemini?</span>{" "}
          <span className="text-muted-foreground">No key needed: connect in one click.</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
      </Link>
      <ApiKeys
        origin={origin}
        companies={orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug }))}
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          access: k.access,
          organizationIds: k.organizationIds,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          expiresAt: k.expiresAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
          clientId: k.clientId,
        }))}
      />
      <p className="text-muted-foreground text-sm">
        Everything a key changes is in each company's audit log, marked with the key. Read the{" "}
        <Link
          href={`${SITE_URL}/developers`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          API and MCP guide
        </Link>{" "}
        for every tool and route.
      </p>
    </>
  );
}
