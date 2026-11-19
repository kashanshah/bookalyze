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
  /** What to do there, in order. "{link}" is where the Bookalyze link goes. */
  steps: string[];
  /** Who can use it, when the assistant limits it. */
  note?: string;
  /** A one-click install link (a custom URL scheme the app handles). */
  installLink?: (mcpUrl: string) => string;
  /** A command to run in a terminal. */
  command?: (mcpUrl: string) => string;
  /** What to do after the install link or command. */
  after?: string;
  /** The assistant's own help page for custom connectors. */
  help?: string;
  /** Recognises the assistant from the name it registered with. */
  matches: RegExp;
};

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
      "Select + and then Add custom MCP server.",
      "Name it Bookalyze and paste the link: {link}",
      "Choose OAuth to sign in, confirm, and create it.",
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
    steps: [
      "Select + Add, then Add custom connector.",
      "Name it Bookalyze, paste the link and continue: {link}",
      "Keep the recommended sign-in and select Add.",
      "Select Connect, sign in to Bookalyze and choose what Claude may do.",
    ],
    note: "Works on every Claude plan (Free includes one custom connector). On Team and Enterprise, an owner adds it once in Admin settings, then each person connects.",
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
