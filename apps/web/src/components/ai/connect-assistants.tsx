"use client";

import {
  type Assistant,
  type AssistantId,
  CHAT_ASSISTANTS,
  DEVELOPER_TOOLS,
  examplePrompts,
  openUrlFor,
} from "@bookalyze/core";
import {
  Asterisk,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  History,
  type LucideIcon,
  MessagesSquare,
  MousePointerClick,
  PencilLine,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Terminal,
  Unplug,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeApiKeyAction } from "@/app/account/api-keys/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { AssistantConnection } from "@/server/ai-assistants";

const ICONS: Record<AssistantId, LucideIcon> = {
  chatgpt: MessagesSquare,
  claude: Asterisk,
  gemini: Sparkles,
  "claude-code": SquareTerminal,
  cursor: MousePointerClick,
  vscode: Code2,
  "gemini-cli": Terminal,
};

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
    return true;
  } catch {
    toast.error("Couldn't copy. Select the text and copy it.");
    return false;
  }
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function AssistantMark({ id, className }: { id: AssistantId; className?: string }) {
  const Icon = ICONS[id];
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary",
        className,
      )}
    >
      <Icon className="size-5.5" aria-hidden="true" />
    </span>
  );
}

/** The MCP link, shown in full with a copy button. */
function LinkField({ url, compact }: { url: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-xl border bg-background ps-3",
        compact ? "py-1 pe-1" : "py-1.5 pe-1.5",
      )}
    >
      <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[13px]" title={url}>
        {url}
      </code>
      <Button size="sm" variant="secondary" onClick={() => copy(url, "Link")}>
        <Copy />
        Copy
      </Button>
    </div>
  );
}

export function ConnectAssistants({
  origin,
  mcpUrl,
  connections,
  companyName,
  listings = {},
}: {
  origin: string;
  mcpUrl: string;
  connections: AssistantConnection[];
  companyName?: string;
  /** Bookalyze's page in an assistant's directory, once listed: connecting is one click there. */
  listings?: Partial<Record<AssistantId, string>>;
}) {
  const [open, setOpen] = useState<Assistant | null>(null);
  const connectedTo = (id: AssistantId) => connections.find((c) => c.assistant === id);
  const prompts = examplePrompts(companyName ?? "my company");

  return (
    <div className="grid gap-8">
      <section className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-xs sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -end-24 -top-24 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative grid gap-5">
          <div className="grid gap-2">
            <Badge variant="primary" className="w-fit">
              <Sparkles />
              Works with ChatGPT, Claude and Gemini
            </Badge>
            <h2 className="text-balance font-semibold text-xl tracking-tight sm:text-2xl">
              Your books, inside your AI assistant
            </h2>
            <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
              Connect once, then ask in plain words: profit last month, what's uncategorised,
              reconcile the bank, upload a statement. The assistant works through Bookalyze under
              your rules. It acts as you, can be read-only, and every change it makes is in the
              audit log.
            </p>
          </div>
          <div className="grid max-w-xl gap-1.5">
            <p className="font-medium text-sm">Your Bookalyze connection link</p>
            <LinkField url={mcpUrl} />
            <p className="text-muted-foreground text-xs">
              The same link works in every assistant. It isn't a password: each assistant still has
              to sign in to Bookalyze, and you approve it.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="chat-assistants">
        <h2 id="chat-assistants" className="font-semibold">
          Chat assistants
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {CHAT_ASSISTANTS.map((a) => {
            const connection = connectedTo(a.id);
            return (
              <div
                key={a.id}
                className="fade-in-0 slide-in-from-bottom-1 flex animate-in flex-col gap-4 rounded-2xl border bg-card p-5 shadow-xs duration-300"
              >
                <div className="flex items-start gap-3">
                  <AssistantMark id={a.id} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-tight">{a.name}</p>
                    <p className="text-muted-foreground text-xs">by {a.maker}</p>
                  </div>
                  {connection ? (
                    <Badge variant="success">
                      <Check />
                      Connected
                    </Badge>
                  ) : null}
                </div>
                <p className="flex-1 text-muted-foreground text-sm">
                  {connection
                    ? `${connection.access === "write" ? "Can read and update" : "Can read"} ${
                        connection.allCompanies ? "all your companies" : "some of your companies"
                      }. Connected ${shortDate(connection.createdAt)}.`
                    : a.tagline}
                </p>
                <Button
                  variant={connection ? "outline" : "default"}
                  onClick={() => setOpen(a)}
                  aria-label={`${connection ? "Connect again" : "Connect"} ${a.name}`}
                >
                  {connection ? "Connect again" : `Connect ${a.name}`}
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="developer-tools">
        <div>
          <h2 id="developer-tools" className="font-semibold">
            Developer tools
          </h2>
          <p className="text-muted-foreground text-sm">
            For coding assistants. Each signs in to Bookalyze the same way.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {DEVELOPER_TOOLS.map((a) => (
            <DeveloperTool key={a.id} assistant={a} url={mcpUrl} connected={!!connectedTo(a.id)} />
          ))}
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="try-asking">
        <h2 id="try-asking" className="font-semibold">
          Then try asking
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {prompts.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => copy(p, "Question")}
                className="group flex h-full w-full items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-start text-sm shadow-xs transition-colors hover:bg-accent"
              >
                <span className="flex-1">“{p}”</span>
                <Copy
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Connections connections={connections} />

      <section className="grid gap-4 rounded-2xl border bg-muted/40 p-5 sm:grid-cols-3">
        <Pledge icon={ShieldCheck} title="Never more than you">
          An assistant acts as you, with your role in each company. Make it read-only or limit it to
          some companies when you connect.
        </Pledge>
        <Pledge icon={PencilLine} title="Same rules as the app">
          Closed periods, reconciled lines and balanced entries are checked for every change, as if
          you made it.
        </Pledge>
        <Pledge icon={History} title="Every change on record">
          Each change is in the company's audit log, marked with the assistant that made it.
          Disconnect at any time.
        </Pledge>
      </section>

      <p className="text-muted-foreground text-xs">
        Scripts and other tools can use an API key instead:{" "}
        <Link
          href="/account/api-keys"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Keys and connected apps
        </Link>
        . ChatGPT, Claude, Gemini and other names are trademarks of their owners. They don't make or
        endorse Bookalyze. Signing in happens at {new URL(origin).host}.
      </p>

      <ConnectDialog
        assistant={open}
        url={mcpUrl}
        listing={open ? listings[open.id] : undefined}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

function Pledge({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <p className="flex items-center gap-2 font-medium text-sm">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        {title}
      </p>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}

function DeveloperTool({
  assistant: a,
  url,
  connected,
}: {
  assistant: Assistant;
  url: string;
  connected: boolean;
}) {
  const command = a.command?.(url);
  return (
    <div className="grid content-start gap-3 rounded-2xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-3">
        <AssistantMark id={a.id} className="size-9 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm leading-tight">{a.name}</p>
          <p className="text-muted-foreground text-xs">{a.tagline}</p>
        </div>
        {connected ? (
          <Badge variant="success">
            <Check />
            Connected
          </Badge>
        ) : null}
      </div>
      {a.installLink ? (
        <Button asChild variant="outline" className="w-fit">
          <a href={a.installLink(url)}>Add to {a.name}</a>
        </Button>
      ) : null}
      {command ? (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-muted/40 py-1 ps-3 pe-1">
          <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs" title={command}>
            {command}
          </code>
          <Button size="sm" variant="ghost" onClick={() => copy(command, "Command")}>
            <Copy />
            <span className="sr-only">Copy the {a.name} command</span>
          </Button>
        </div>
      ) : null}
      {a.after ? <p className="text-muted-foreground text-xs">{a.after}</p> : null}
    </div>
  );
}

function ConnectDialog({
  assistant: a,
  url,
  listing,
  onClose,
}: {
  assistant: Assistant | null;
  url: string;
  /** Bookalyze's listing in the assistant's directory: no link to paste. */
  listing?: string;
  onClose: () => void;
}) {
  const [opened, setOpened] = useState(false);
  async function copyAndOpen() {
    if (!a) return;
    const target = listing ?? openUrlFor(a, url);
    if (!target) return;
    if (!listing) await copy(url, "Link");
    window.open(target, "_blank", "noopener,noreferrer");
    setOpened(true);
  }
  const steps = a
    ? listing
      ? [
          `Select Connect on Bookalyze's page in ${a.name}.`,
          `Sign in to Bookalyze and choose what ${a.name} may do.`,
        ]
      : a.steps
    : [];
  return (
    <Dialog
      open={!!a}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setOpened(false);
        }
      }}
    >
      {a ? (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mb-1 flex items-center gap-3">
              <AssistantMark id={a.id} />
              <DialogTitle>Connect {a.name} to Bookalyze</DialogTitle>
            </div>
            <DialogDescription>
              {listing
                ? `Bookalyze is in ${a.name}'s directory. Open it, select Connect, then sign in to Bookalyze and choose what ${a.name} may do.`
                : a.prefill
                  ? `One click opens ${a.name} with Bookalyze filled in. Confirm there, then sign in to Bookalyze and choose what ${a.name} may do.`
                  : `One click copies your link and opens ${a.name}. Paste it there, then sign in to Bookalyze and choose what ${a.name} may do.`}
            </DialogDescription>
          </DialogHeader>
          <Button size="lg" onClick={copyAndOpen}>
            {opened ? <Check /> : <ExternalLink />}
            {listing
              ? opened
                ? `${a.name} is open`
                : `Open Bookalyze in ${a.name}`
              : opened
                ? `Link copied. ${a.name} is open`
                : `Copy link and open ${a.name}`}
          </Button>
          <ol className="grid gap-3">
            {steps.map((step, i) => {
              const icon = step.includes("{icon}");
              const [before, after] = step.replace("{icon}", "").split("{link}");
              return (
                <li key={step} className="flex gap-3 text-sm">
                  <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-xs">
                    {i + 1}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-2 pt-0.5">
                    <span>
                      {before}
                      {after ?? ""}
                    </span>
                    {after !== undefined ? <LinkField url={url} compact /> : null}
                    {icon ? (
                      <a
                        href="/connector-icon.png"
                        download="bookalyze-icon.png"
                        className="inline-flex w-fit items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 font-medium text-xs shadow-xs transition-colors hover:bg-muted"
                      >
                        {/* biome-ignore lint/performance/noImgElement: a tiny static icon */}
                        <img src="/connector-icon.png" alt="" className="size-5 rounded" />
                        Download the Bookalyze icon
                        <Download className="size-3.5 text-muted-foreground" />
                      </a>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {a.note && !listing ? (
            <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-muted-foreground text-xs leading-relaxed">
              {a.note}
            </p>
          ) : null}
          <DialogFooter className="items-center gap-2 sm:justify-between">
            {a.help ? (
              <a
                href={a.help}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
              >
                {a.maker}'s help for custom connectors
              </a>
            ) : (
              <span />
            )}
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Connections({ connections }: { connections: AssistantConnection[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!connections.length) return null;
  return (
    <section className="grid gap-3" aria-labelledby="connected">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="connected" className="font-semibold">
          Connected now
        </h2>
        <Link
          href="/account/api-keys"
          className="font-medium text-primary text-sm underline-offset-4 hover:underline"
        >
          Keys and connected apps
        </Link>
      </div>
      <ul className="divide-y rounded-2xl border bg-card shadow-xs">
        {connections.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            {c.assistant ? (
              <AssistantMark id={c.assistant} className="size-9 rounded-lg" />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Unplug className="size-4" aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-sm">{c.name}</span>
              <span className="block text-muted-foreground text-xs">
                {c.access === "write" ? "Read and write" : "Read only"} ·{" "}
                {c.allCompanies ? "All your companies" : "Some companies"} · Connected{" "}
                {shortDate(c.createdAt)}
                {c.lastUsedAt ? ` · Last used ${shortDate(c.lastUsedAt)}` : ""}
              </span>
            </span>
            {confirming === c.id ? (
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const result = await revokeApiKeyAction(c.id);
                      if (result.ok) {
                        toast.success(`“${c.name}” disconnected. It stops working right away.`);
                        router.refresh();
                      } else toast.error(result.message ?? "Couldn't disconnect it.");
                      setConfirming(null);
                    })
                  }
                >
                  Disconnect now
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirming(c.id)}>
                Disconnect
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
