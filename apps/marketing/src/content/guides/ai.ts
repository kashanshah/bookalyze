import { ASSISTANTS, type AssistantId, mcpUrl } from "@bookalyze/core";
import { APP_URL } from "../../lib/site";
import type { Block, Guide } from "./types";

/**
 * AI assistants: ChatGPT, Claude, Gemini and coding assistants working in the books through
 * Bookalyze's MCP server. The steps come from the app's own list (packages/core site/assistants),
 * so the guides and Settings → AI assistants always say the same thing.
 */

const LINK = mcpUrl(APP_URL);
const ICON = `${APP_URL.replace(/\/$/, "")}/connector-icon.png`;

function assistant(id: AssistantId) {
  const a = ASSISTANTS.find((x) => x.id === id);
  if (!a) throw new Error(`No assistant ${id}`);
  return a;
}

/** The assistant's own steps, numbered, with the Bookalyze link filled in. */
function connectSteps(id: AssistantId): Block[] {
  const a = assistant(id);
  return [
    { where: "Settings → AI assistants → Connect " + a.name },
    {
      steps: [
        {
          title: `Copy the link and open ${a.name}`,
          body: `In Bookalyze, **Connect ${a.name}** copies your connection link (${LINK}) and opens ${a.name}'s connector settings in a new tab.`,
        },
        ...a.steps.map((s) => ({
          title: s.replace("{link}", LINK).replace("{icon}", `(${ICON})`),
          body: "",
        })),
      ],
    },
    ...(a.note ? [{ note: a.note }] : []),
  ];
}

const CONSENT: Block = {
  list: [
    "**What it may do:** read only (see transactions, balances and reports) or read and write (also categorise, reconcile, upload statements and post entries).",
    "**Which companies:** all of yours, including ones you join later, or just the ones you tick.",
    "**How long:** 30 days, 90 days, a year, or until you disconnect it.",
  ],
};

const FIRST_QUESTIONS: Block = {
  list: [
    "“List my Bookalyze companies.”",
    "“What was my profit last month, and what changed from the month before?”",
    "“Which transactions are still uncategorised? Suggest a category for each.”",
    "“Reconcile Wise CAD to today's balance of 12,480.55.”",
  ],
};

const CHECK: Block = {
  check: [
    "Settings → AI assistants shows the assistant as **Connected**",
    "Asked “List my Bookalyze companies”, it answers with your companies",
    "Anything it changes is in the company's audit log, marked with its name",
  ],
};

export const AI_GUIDES: readonly Guide[] = [
  {
    slug: "connect-ai-assistant",
    category: "ai",
    title: "Use Bookalyze from ChatGPT, Claude or Gemini",
    summary:
      "Connect your AI assistant in a minute, then ask about your books in plain words or have it do the bookkeeping, under the same rules as the app.",
    sections: [
      {
        heading: "What it is",
        blocks: [
          {
            p: "Bookalyze has a connector that AI assistants understand (an **MCP server**). Once your assistant is connected, it can read your real numbers and, if you allow it, do the work: categorise transactions, reconcile a bank account, upload a statement, post a journal entry or pull any report. You just ask.",
          },
          {
            p: "It doesn't copy your books anywhere. Each question is answered live from Bookalyze, as you, and only within what you approved.",
          },
        ],
      },
      {
        heading: "Connect in a minute",
        blocks: [
          { where: "Settings → AI assistants (or your account menu → Connect AI assistants)" },
          {
            steps: [
              {
                title: "Choose your assistant",
                body: "**Connect ChatGPT**, **Connect Claude** or **Connect Gemini**. One click copies your link and opens the assistant's connector settings.",
              },
              {
                title: "Paste the link there",
                body: `Add a custom connector named Bookalyze with the link ${LINK}. The assistant's own guide below says exactly where to click.`,
              },
              {
                title: "Sign in to Bookalyze and choose",
                body: "The assistant sends you to Bookalyze. Choose what it may do and select **Allow access**. You're back in the assistant, connected.",
              },
            ],
          },
          {
            note: "There's no key or password to copy. The assistant signs in to Bookalyze like an app on your phone would, and you can disconnect it at any time.",
            tone: "tip",
          },
        ],
      },
      { heading: "What you choose when you connect", blocks: [CONSENT] },
      {
        heading: "Which assistants",
        blocks: [
          {
            table: {
              head: ["Assistant", "How it connects"],
              rows: [
                ["ChatGPT", "A custom connector in ChatGPT's settings"],
                ["Claude (web, desktop, mobile)", "A custom connector in Claude's settings"],
                ["Gemini", "A custom app in the Gemini web app, then on your phone too"],
                ["Claude Code", "One command in your terminal, then /mcp to sign in"],
                ["Cursor and VS Code", "One click on Add to Cursor or Add to VS Code"],
                ["Gemini CLI", "One command, then /mcp auth bookalyze"],
              ],
            },
          },
        ],
      },
      { heading: "Try asking", blocks: [FIRST_QUESTIONS] },
      { heading: "What you should see", blocks: [CHECK] },
    ],
    related: ["connect-chatgpt", "connect-claude", "connect-gemini", "ai-assistant-safety"],
  },
  {
    slug: "connect-chatgpt",
    category: "ai",
    title: "Connect ChatGPT to your books",
    summary:
      "Add Bookalyze to ChatGPT as a custom connector, sign in, and ask ChatGPT about your profit, transactions and bank accounts.",
    sections: [
      { heading: "Connect", blocks: connectSteps("chatgpt") },
      { heading: "What you choose when you connect", blocks: [CONSENT] },
      {
        heading: "Using it",
        blocks: [
          {
            p: "Ask in any chat, or mention Bookalyze to make sure ChatGPT uses it. ChatGPT asks before it changes anything, and only if you allowed read and write.",
          },
          FIRST_QUESTIONS,
        ],
      },
      { heading: "What you should see", blocks: [CHECK] },
    ],
    related: ["connect-ai-assistant", "ai-assistant-month-end", "ai-assistant-safety"],
  },
  {
    slug: "connect-claude",
    category: "ai",
    title: "Connect Claude to your books",
    summary:
      "Add Bookalyze to Claude on the web, desktop or phone, or to Claude Code in one command, and work on your books in conversation.",
    sections: [
      { heading: "Claude on the web, desktop and mobile", blocks: connectSteps("claude") },
      {
        heading: "Claude Code",
        blocks: [
          { p: "In a terminal, run:" },
          { code: assistant("claude-code").command?.(LINK) ?? "" },
          { p: assistant("claude-code").after ?? "" },
        ],
      },
      { heading: "What you choose when you connect", blocks: [CONSENT] },
      { heading: "Try asking", blocks: [FIRST_QUESTIONS] },
      { heading: "What you should see", blocks: [CHECK] },
    ],
    related: ["connect-ai-assistant", "ai-assistant-month-end", "ai-assistant-safety"],
  },
  {
    slug: "connect-gemini",
    category: "ai",
    title: "Connect Gemini to your books",
    summary:
      "Add Bookalyze to the Gemini app as a custom app, or to Gemini CLI, and ask Gemini about your books from the web or your phone.",
    sections: [
      { heading: "The Gemini app", blocks: connectSteps("gemini") },
      {
        heading: "Gemini CLI",
        blocks: [
          { p: "In a terminal, run:" },
          { code: assistant("gemini-cli").command?.(LINK) ?? "" },
          { p: assistant("gemini-cli").after ?? "" },
        ],
      },
      { heading: "What you choose when you connect", blocks: [CONSENT] },
      { heading: "Try asking", blocks: [FIRST_QUESTIONS] },
      { heading: "What you should see", blocks: [CHECK] },
    ],
    related: ["connect-ai-assistant", "ai-assistant-month-end", "ai-assistant-safety"],
  },
  {
    slug: "ai-assistant-month-end",
    category: "ai",
    title: "Month-end with an AI assistant: what to ask",
    summary:
      "A month's close done in conversation: catch up the bank, categorise, reconcile, post the marketplaces and read the results, with you approving each step.",
    sections: [
      {
        heading: "Before you start",
        blocks: [
          {
            p: "Connect your assistant with **read and write** for the company you're closing (see Use Bookalyze from ChatGPT, Claude or Gemini). Everything below is something you could do in the app; the assistant just does the clicking.",
          },
        ],
      },
      {
        heading: "The close, one question at a time",
        blocks: [
          {
            steps: [
              {
                title: "Catch up the bank",
                body: "“Sync Wise for Maple Goods, then upload this RBC statement. Show me a dry run first.”",
              },
              {
                title: "Categorise",
                body: "“List October's uncategorised transactions and suggest a category for each, based on how I categorised similar ones.” Then: “Go ahead with all but the third.”",
              },
              {
                title: "Reconcile",
                body: "“Reconcile RBC Chequing to the October 31 statement balance of 24,118.07 and tell me what doesn't match.”",
              },
              {
                title: "Read the month",
                body: "“Show October's profit and loss next to September's, and explain the three biggest changes.”",
              },
            ],
          },
          {
            note: "Closed periods, reconciled lines and balanced entries are checked for every change, exactly as when you click. If something isn't allowed, the assistant is told why, in plain words.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "No uncategorised transactions left for the month",
              "Each bank account reconciled to its statement",
              "Every change in the audit log, marked with the assistant",
            ],
          },
        ],
      },
    ],
    related: ["connect-ai-assistant", "ai-assistant-safety", "month-end-for-sellers"],
  },
  {
    slug: "ai-assistant-safety",
    category: "ai",
    title: "What an AI assistant can and can't do in your books",
    summary:
      "An assistant acts as you and never more, only within what you approved, under the app's own rules, with every change recorded. And you can disconnect it at any time.",
    sections: [
      {
        heading: "The rules it works under",
        blocks: [
          {
            list: [
              "**It acts as you.** Your role in each company applies. A member can't do an owner's job through an assistant.",
              "**Only what you approved.** Read-only assistants can't change anything, and they don't even see the tools that would.",
              "**Only the companies you chose.** Others don't exist for it.",
              "**The app's own checks.** Closed periods, reconciled lines, balanced entries and your plan's limits apply to every change.",
              "**On the record.** Each change is in the company's audit log, marked with the assistant that made it.",
            ],
          },
        ],
      },
      {
        heading: "How it signs in",
        blocks: [
          {
            p: "Assistants sign in with Bookalyze using OAuth, the standard behind “Sign in with Google”. Bookalyze never sees your assistant's password, and the assistant never sees yours. It gets a pass that works for an hour at a time, renewed while the connection lasts.",
          },
          {
            p: "Only you can connect an assistant, on Bookalyze's own page, signed in. An assistant can't connect other assistants or make API keys.",
          },
        ],
      },
      {
        heading: "Disconnecting",
        blocks: [
          { where: "Settings → AI assistants → Connected now → Disconnect" },
          { p: "It stops working at once, on its very next request." },
        ],
      },
    ],
    related: ["connect-ai-assistant", "ai-assistant-month-end"],
  },
];
