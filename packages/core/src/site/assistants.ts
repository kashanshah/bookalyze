/**
 * The AI assistants Bookalyze connects to, and how. Every one of them talks to the same MCP
 * server (`/api/mcp`) and signs in with Bookalyze (OAuth): the person approves on Bookalyze's
 * consent screen and chooses what the assistant may do. No key to copy.
 *
 * Chat assistants (ChatGPT, Claude, Gemini) add a connector from their own settings: we copy the
 * link and open the right page in one click, and say exactly what to click there. Developer tools
 * install from a link (Cursor, VS Code) or one command (Claude Code, Gemini CLI).
 *
 * Their menus change now and then; keep the steps short and check them against each app's help
 * page when one changes (links in `help`).
 */

export type AssistantId =
  | "chatgpt"
  | "claude"
  | "gemini"
  | "claude-code"
  | "cursor"
  | "vscode"
  | "gemini-cli";

export type Assistant = {
  id: AssistantId;
  name: string;
  maker: string;
  kind: "chat" | "developer";
  /** One line under the name. */
  tagline: string;
  /** The page in the assistant where a connector is added (opened in a new tab). */
  openUrl?: string;
  /** Opens the assistant's add-connector form with Bookalyze's name and link filled in. */
  prefill?: (link: string) => string;
  /** What to do there, in order. "{link}" is where the Bookalyze link goes. */
  steps: string[];
  /** Who can use it, when the assistant limits it. */
  note?: string;
  /** A one-click install link (a custom URL scheme the app handles). */
  installLink?: (mcpUrl: string) => string;
  /** A command to run in a terminal. */
  command?: (mcpUrl: string) => string;
  // In steps, {link} marks where the connection link goes and {icon} a download of our icon.
  /** What to do after the install link or command. */
  after?: string;
  /** The assistant's own help page for custom connectors. */
  help?: string;
  /** Recognises the assistant from the name it registered with. */
  matches: RegExp;
};

/** Where "Connect" sends the person: the prefilled form when there is one. */
export function openUrlFor(a: Assistant, link: string): string | undefined {
  return a.prefill?.(link) ?? a.openUrl;
}

/** The address every assistant connects to. */
export function mcpUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/mcp`;
}

export const ASSISTANTS: readonly Assistant[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    maker: "OpenAI",
    kind: "chat",
    tagline: "Ask about your books in any ChatGPT chat.",
    openUrl: "https://chatgpt.com/plugins",
    steps: [
      "Select Add (top right), then Add custom MCP server.",
      "Name it Bookalyze and paste the link under Server URL: {link}",
      "Optional: add the icon so Bookalyze is easy to spot. {icon}",
      "Keep Authentication as OAuth, tick I understand and want to continue, and select Create as a plugin.",
      "Sign in to Bookalyze when asked and choose what ChatGPT may do.",
    ],
    note: "Custom connectors depend on your ChatGPT plan and workspace settings. If you don't see the option, ask your workspace admin.",
    help: "https://developers.openai.com/plugins/deploy/connect-chatgpt",
    matches: /chatgpt|openai/i,
  },
  {
    id: "claude",
    name: "Claude",
    maker: "Anthropic",
    kind: "chat",
    tagline: "Claude on the web, desktop and mobile.",
    openUrl: "https://claude.ai/customize/connectors",
    prefill: (link) =>
      `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Bookalyze&connectorUrl=${encodeURIComponent(link)}`,
    steps: [
      "Claude opens Add custom connector with Bookalyze's name and link filled in. Select Continue. (In the Claude desktop app: Plugins → Add → Add custom connector, and paste the link.) {link}",
      "If Claude asks about the OAuth client, choose Register automatically. Then select Add.",
      "Sign in to Bookalyze when Claude asks, and choose what Claude may do.",
    ],
    note: "To use it in a chat, select + → Connectors and switch Bookalyze on. Works on every Claude plan (Free includes one custom connector). On Team and Enterprise, an owner adds it once in Admin settings, then each person connects.",
    help: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    matches: /^(?!.*code)(.*\bclaude\b|anthropic)/i,
  },
  {
    id: "gemini",
    name: "Gemini",
    maker: "Google",
    kind: "chat",
    tagline: "The Gemini app on the web and your phone.",
    openUrl: "https://gemini.google.com/app",
    steps: [
      "Open Settings, then Connected apps.",
      "Under Custom apps, select Add a custom app.",
      "Paste the link and select Next: {link}",
      "Sign in to Bookalyze and choose what Gemini may do.",
    ],
    note: "Google offers custom apps in the US, in English, to people 18 or over with a personal Google Account. They're added on the web and then work on your phone too.",
    help: "https://support.google.com/gemini/answer/17209137",
    matches: /^(?!.*\bcli\b)(.*gemini|google)/i,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    maker: "Anthropic",
    kind: "developer",
    tagline: "In your terminal.",
    steps: [],
    command: (url) => `claude mcp add --transport http bookalyze ${url}`,
    after: "Then type /mcp in Claude Code, choose bookalyze and sign in.",
    matches: /claude[\s-]?code/i,
  },
  {
    id: "cursor",
    name: "Cursor",
    maker: "Anysphere",
    kind: "developer",
    tagline: "Installs in one click.",
    steps: [],
    installLink: (url) =>
      `cursor://anysphere.cursor-deeplink/mcp/install?name=bookalyze&config=${encodeBase64(
        JSON.stringify({ url }),
      )}`,
    after: "Cursor asks to install Bookalyze, then opens Bookalyze to sign in.",
    matches: /cursor/i,
  },
  {
    id: "vscode",
    name: "VS Code",
    maker: "Microsoft",
    kind: "developer",
    tagline: "For GitHub Copilot's agent mode.",
    steps: [],
    installLink: (url) =>
      `vscode:mcp/install?${encodeURIComponent(
        JSON.stringify({ name: "bookalyze", type: "http", url }),
      )}`,
    after: "VS Code asks to install Bookalyze, then opens Bookalyze to sign in.",
    matches: /visual studio code|vs ?code/i,
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    maker: "Google",
    kind: "developer",
    tagline: "In your terminal.",
    steps: [],
    command: (url) => `gemini mcp add --transport http bookalyze ${url}`,
    after: "Then run /mcp auth bookalyze in Gemini CLI and sign in.",
    matches: /gemini[\s-]?cli/i,
  },
];

export const CHAT_ASSISTANTS = ASSISTANTS.filter((a) => a.kind === "chat");
export const DEVELOPER_TOOLS = ASSISTANTS.filter((a) => a.kind === "developer");

/**
 * Which assistant an approved app is, from the name it registered with ("ChatGPT", "Claude",
 * "Claude Code", "Gemini"…). Developer tools are checked first, so "Claude Code" isn't Claude.
 * Null for anything else (it still shows as a connected app).
 */
export function assistantFor(appName: string): AssistantId | null {
  for (const a of [...DEVELOPER_TOOLS, ...CHAT_ASSISTANTS]) {
    if (a.matches.test(appName)) return a.id;
  }
  return null;
}

/** Things to ask once connected, about one company. */
export function examplePrompts(company: string): string[] {
  return [
    `What was ${company}'s profit last month, and what changed from the month before?`,
    `Categorise this week's uncategorised transactions in ${company}.`,
    `Reconcile the main bank account in ${company} to today's balance.`,
    `Which expenses grew the most in ${company} this quarter?`,
  ];
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** A connection as the reminders need it (an API key row that an app got by signing in). */
export type ReminderSource = {
  id: string;
  name: string;
  clientId: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

/** "Ends soon" or "has ended": the assistant will stop (or has stopped) reaching the books. */
export type AssistantReminder = {
  /** What a dismissal remembers: the connection and which of the two reminders it was. */
  key: string;
  id: string;
  name: string;
  kind: "ending" | "ended";
  /** When access ends or ended. */
  at: Date;
  /** Whole days left, at least 1 (only for "ending"). */
  daysLeft: number;
};

const DAY = 24 * 60 * 60 * 1000;
/** Remind this many days before access ends… */
export const REMIND_BEFORE_DAYS = 7;
/** …and for this long after, unless the person reconnects or dismisses it. */
export const REMIND_AFTER_DAYS = 30;

export function reminderKey(id: string, kind: AssistantReminder["kind"]): string {
  return `${id}~${kind === "ending" ? "s" : "e"}`;
}

/**
 * Connections whose access ends within a week, or ended in the last 30 days, that haven't
 * been reconnected (a live connection with the same name, lasting longer, replaces it) or
 * dismissed. One per app, the ended ones first. Plain API keys (no clientId) aren't included:
 * the person made those themselves and the API keys page shows when they end.
 */
export function assistantReminders(
  keys: readonly ReminderSource[],
  now: Date,
  dismissed: ReadonlySet<string> = new Set(),
): AssistantReminder[] {
  const t = now.getTime();
  const apps = keys.filter((k) => k.clientId && !k.revokedAt);
  const live = apps.filter((k) => !k.expiresAt || k.expiresAt.getTime() > t);
  const sameApp = (a: { name: string }, b: { name: string }) =>
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
  const replaced = (k: ReminderSource) =>
    live.some(
      (o) =>
        o.id !== k.id &&
        sameApp(o, k) &&
        (!o.expiresAt || (k.expiresAt !== null && o.expiresAt.getTime() > k.expiresAt.getTime())),
    );

  const found: AssistantReminder[] = [];
  for (const k of apps) {
    if (!k.expiresAt || replaced(k)) continue;
    const left = k.expiresAt.getTime() - t;
    const kind = left > 0 ? "ending" : "ended";
    if (kind === "ending" && left > REMIND_BEFORE_DAYS * DAY) continue;
    if (kind === "ended" && -left > REMIND_AFTER_DAYS * DAY) continue;
    const key = reminderKey(k.id, kind);
    if (dismissed.has(key)) continue;
    found.push({
      key,
      id: k.id,
      name: k.name,
      kind,
      at: k.expiresAt,
      daysLeft: Math.max(1, Math.ceil(left / DAY)),
    });
  }
  found.sort((a, b) =>
    a.kind === b.kind ? b.at.getTime() - a.at.getTime() : a.kind === "ended" ? -1 : 1,
  );
  return found.filter((r, i) => found.findIndex((o) => sameApp(o, r)) === i);
}
