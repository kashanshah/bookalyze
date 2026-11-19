import {
  ArrowRight,
  Bot,
  FileSpreadsheet,
  History,
  KeyRound,
  Landmark,
  type LucideIcon,
  Receipt,
  RefreshCw,
  Scale,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { ClosingCta } from "@/components/cta";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { APP_URL, SIGN_UP_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Bookalyze for AI agents: API + MCP",
  description:
    "Connect Claude Code or any MCP client to your books. Categorise transactions, reconcile bank accounts, upload statements and pull reports through the Bookalyze MCP server or REST API, with keys you control.",
  alternates: { canonical: "/developers" },
};

const MCP_URL = `${APP_URL}/api/mcp`;
const API_URL = `${APP_URL}/api/v1`;
const COMMAND = `claude mcp add --transport http bookalyze ${MCP_URL} \\
  --header "Authorization: Bearer bka_your_key"`;

const STEPS = [
  {
    title: "Make a key",
    body: "In Bookalyze, open your account menu → API keys. Choose read-only or read and write, all your companies or just some, and when it stops working.",
  },
  {
    title: "Add it to Claude Code",
    body: "Run one command. The key is shown once, with the command filled in, ready to copy.",
  },
  {
    title: "Ask in plain words",
    body: "“Categorise last week's Wise transactions”, “Reconcile RBC to the October statement”, “What was our profit in Q3?”",
  },
] as const;

const CAN_DO: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Receipt,
    title: "Transactions",
    body: "Search, add, edit, split and categorise; mark them reviewed; match transfers between accounts, in any currency.",
  },
  {
    icon: Landmark,
    title: "Bank accounts",
    body: "Balances, the bank's own balance and when each account was last reconciled. Start, tick off and finish a reconciliation.",
  },
  {
    icon: RefreshCw,
    title: "Sync and uploads",
    body: "Sync a bank connection such as Wise, upload a CSV statement (with a dry run first) and attach receipts to transactions.",
  },
  {
    icon: Scale,
    title: "Journal entries",
    body: "Post balanced entries, owner contributions and drawings, and reverse an entry when it was wrong.",
  },
  {
    icon: FileSpreadsheet,
    title: "Reports",
    body: "Profit and loss, balance sheet, trial balance, general ledger, sales tax and the accountant's transaction export.",
  },
  {
    icon: Bot,
    title: "Everything else in the app",
    body: "Purchase orders and their payments, vendors, and the rest of what you can do on screen, through the same actions the app uses.",
  },
];

const SAFETY = [
  "Keys act as you, with your role in each company, and never more",
  "Read-only keys can't change anything, and agents don't even see the tools that would",
  "Limit a key to some companies; the others don't exist for it",
  "Every change runs through the same checks as the app: closed periods, reconciled lines, balanced entries",
  "Each change is in the company's audit log, marked with the key that made it",
  "Keys are stored only as a fingerprint, expire when you choose, and can be revoked at once",
] as const;

function Code({ children, label }: { children: string; label: string }) {
  return (
    <figure className="grid min-w-0 gap-2">
      <figcaption className="flex items-center gap-2 text-muted-foreground text-xs">
        <Terminal className="size-3.5" aria-hidden="true" />
        {label}
      </figcaption>
      <pre
        dir="ltr"
        className="overflow-x-auto whitespace-pre-wrap rounded-xl border bg-card p-4 text-start font-mono text-[13px] leading-6 shadow-xs [overflow-wrap:anywhere]"
      >
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export default function DevelopersPage() {
  return (
    <>
      <Section className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        <div className="fade-in-0 slide-in-from-bottom-3 grid min-w-0 animate-in gap-8 duration-700">
          <SectionHeading
            as="h1"
            align="start"
            eyebrow="API + MCP"
            title="Bookalyze for AI agents"
            lead="Let Claude Code, or any agent that speaks MCP, do the bookkeeping with you: categorise, reconcile, upload statements and pull reports, under the same rules as the app."
          />
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={SIGN_UP_URL} size="lg">
              Start free
              <ArrowRight className="rtl:rotate-180" />
            </ButtonLink>
            <ButtonLink href={`${APP_URL}/account/api-keys`} variant="outline" size="lg">
              <KeyRound />
              Make an API key
            </ButtonLink>
          </div>
        </div>
        <div className="fade-in-0 slide-in-from-bottom-3 grid min-w-0 animate-in gap-5 delay-150 duration-700">
          <Code label="Connect Claude Code">{COMMAND}</Code>
          <Code label="Or ask Claude">
            {
              "> Categorise this week's uncategorised transactions in kazomo-ca,\n  then reconcile Wise CAD to today's balance of 12,480.55."
            }
          </Code>
        </div>
      </Section>

      <Section tint className="grid gap-12">
        <SectionHeading
          eyebrow="Three steps"
          title="Connected in a minute"
          lead="No SDK to install. Claude Code talks to Bookalyze directly over HTTPS."
        />
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="grid content-start gap-3 rounded-2xl border bg-card p-6"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-sm">
                {i + 1}
              </span>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-6">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section className="grid gap-12">
        <SectionHeading
          eyebrow="What agents can do"
          title="Everything you do in the browser"
          lead="The MCP server and the REST API offer the same operations, so a script and an agent always agree."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAN_DO.map(({ icon: Icon, title, body }) => (
            <div key={title} className="grid content-start gap-3 rounded-2xl border bg-card p-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="font-medium">{title}</h3>
              <p className="text-muted-foreground text-sm leading-6">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tint className="grid items-start gap-12 lg:grid-cols-2">
        <div className="grid gap-6">
          <SectionHeading
            align="start"
            eyebrow="Safe by design"
            title="Your books, on your terms"
            lead="An agent gets exactly the access you give it, and you can see and undo what it did."
          />
          <Checklist items={SAFETY} />
        </div>
        <div className="grid gap-6 rounded-2xl border bg-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-medium">Read-only to start</h3>
              <p className="text-muted-foreground text-sm">
                Most people begin with a read-only key for reports and questions.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <History className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-medium">Every change in the audit log</h3>
              <p className="text-muted-foreground text-sm">
                Each one says which key made it, so nothing happens behind your back.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section className="grid gap-10">
        <SectionHeading
          eyebrow="For developers"
          title="A plain REST API, too"
          lead="JSON over HTTPS with the same key as a Bearer token. Amounts are exact decimal strings, dates are YYYY-MM-DD."
        />
        <div className="mx-auto grid w-full max-w-3xl gap-5">
          <Code label="List companies">
            {`curl ${API_URL}/companies \\\n  -H "Authorization: Bearer $BOOKALYZE_KEY"`}
          </Code>
          <Code label="Profit and loss for a period">
            {`curl "${API_URL}/companies/kazomo-ca/reports/profit-and-loss?from=2026-01-01&to=2026-09-30" \\\n  -H "Authorization: Bearer $BOOKALYZE_KEY"`}
          </Code>
          <p className="text-center text-muted-foreground text-sm">
            Every route is described in the{" "}
            <a
              href={`${API_URL}/openapi.json`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              OpenAPI document
            </a>
            .
          </p>
        </div>
      </Section>

      <div className="pt-4 sm:pt-8">
        <ClosingCta
          title="Put an agent on your bookkeeping"
          lead="Try everything free for 30 days. Set up a company, make a key, and ask Claude what your profit was last month."
        />
      </div>
    </>
  );
}
