import { describe, expect, it } from "vitest";
import {
  ASSISTANTS,
  assistantFor,
  assistantReminders,
  CHAT_ASSISTANTS,
  DEVELOPER_TOOLS,
  examplePrompts,
  mcpUrl,
  openUrlFor,
} from "../site/assistants";

describe("AI assistants", () => {
  it("connect to the MCP server", () => {
    expect(mcpUrl("https://app.bookalyze.com")).toBe("https://app.bookalyze.com/api/mcp");
    expect(mcpUrl("https://app.bookalyze.com/")).toBe("https://app.bookalyze.com/api/mcp");
  });

  it("lead with ChatGPT, Claude and Gemini, each with a place to open and the link in a step", () => {
    expect(CHAT_ASSISTANTS.map((a) => a.name)).toEqual(["ChatGPT", "Claude", "Gemini"]);
    for (const a of CHAT_ASSISTANTS) {
      expect(a.openUrl).toMatch(/^https:\/\//);
      expect(a.steps.filter((s) => s.includes("{link}"))).toHaveLength(1);
      expect(a.help).toMatch(/^https:\/\//);
    }
    for (const a of DEVELOPER_TOOLS) expect(a.installLink ?? a.command).toBeDefined();
    expect(new Set(ASSISTANTS.map((a) => a.id)).size).toBe(ASSISTANTS.length);
  });

  it("recognise an assistant from the name it registered with", () => {
    expect(assistantFor("ChatGPT")).toBe("chatgpt");
    expect(assistantFor("OpenAI ChatGPT connector")).toBe("chatgpt");
    expect(assistantFor("Claude")).toBe("claude");
    expect(assistantFor("Claude Code")).toBe("claude-code");
    expect(assistantFor("claude-code (bookalyze)")).toBe("claude-code");
    expect(assistantFor("Gemini")).toBe("gemini");
    expect(assistantFor("Google Gemini")).toBe("gemini");
    expect(assistantFor("Gemini CLI")).toBe("gemini-cli");
    expect(assistantFor("Cursor")).toBe("cursor");
    expect(assistantFor("Visual Studio Code")).toBe("vscode");
    expect(assistantFor("My script")).toBeNull();
  });

  it("install in one click where the app supports it", () => {
    const url = "https://app.bookalyze.com/api/mcp";
    const cursor = ASSISTANTS.find((a) => a.id === "cursor")?.installLink?.(url) ?? "";
    const config = new URL(cursor).searchParams.get("config") ?? "";
    expect(JSON.parse(Buffer.from(config, "base64").toString())).toEqual({ url });
    const vscode = ASSISTANTS.find((a) => a.id === "vscode")?.installLink?.(url) ?? "";
    expect(JSON.parse(decodeURIComponent(vscode.replace("vscode:mcp/install?", "")))).toEqual({
      name: "bookalyze",
      type: "http",
      url,
    });
  });

  it("suggest questions about the company", () => {
    expect(examplePrompts("Maple Goods").every((p) => p.includes("Maple Goods"))).toBe(true);
  });

  it("open Claude's add-connector form with Bookalyze filled in", () => {
    const claude = ASSISTANTS.find((a) => a.id === "claude");
    const chatgpt = ASSISTANTS.find((a) => a.id === "chatgpt");
    if (!claude || !chatgpt) throw new Error("missing");
    const link = "https://app.bookalyze.com/api/mcp";
    const url = new URL(openUrlFor(claude, link) ?? "");
    expect(url.searchParams.get("modal")).toBe("add-custom-connector");
    expect(url.searchParams.get("connectorName")).toBe("Bookalyze");
    expect(url.searchParams.get("connectorUrl")).toBe(link);
    expect(openUrlFor(chatgpt, link)).toBe(chatgpt.openUrl);
  });

  describe("reminders", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    const conn = (id: string, name: string, days: number | null, extra = {}) => ({
      id,
      name,
      clientId: `client-${id}`,
      revokedAt: null,
      expiresAt: days === null ? null : new Date(now.getTime() + days * day),
      ...extra,
    });

    it("warn a week before access ends and for 30 days after", () => {
      const r = assistantReminders(
        [
          conn("a", "Claude", 3.5),
          conn("b", "ChatGPT", -2),
          conn("c", "Gemini", 8),
          conn("d", "Cursor", -31),
        ],
        now,
      );
      expect(r.map((x) => [x.name, x.kind, x.daysLeft])).toEqual([
        ["ChatGPT", "ended", 1],
        ["Claude", "ending", 4],
      ]);
    });

    it("skip API keys, revoked connections and ones without an end", () => {
      expect(
        assistantReminders(
          [
            conn("a", "My script", 2, { clientId: null }),
            conn("b", "Claude", -1, { revokedAt: now }),
            conn("c", "ChatGPT", null),
          ],
          now,
        ),
      ).toEqual([]);
    });

    it("stop once the app is connected again, or the reminder is dismissed", () => {
      expect(assistantReminders([conn("a", "Claude", -3), conn("b", "claude ", 90)], now)).toEqual(
        [],
      );
      expect(assistantReminders([conn("a", "Claude", 2), conn("b", "Claude", null)], now)).toEqual(
        [],
      );
      const [ended] = assistantReminders([conn("a", "Claude", -3)], now);
      expect(
        assistantReminders([conn("a", "Claude", -3)], now, new Set([ended?.key ?? ""])),
      ).toEqual([]);
      // Dismissing "ends soon" doesn't hide "has ended" later.
      const [ending] = assistantReminders([conn("a", "Claude", 2)], now);
      expect(ending?.key).not.toBe(ended?.key);
    });

    it("show one reminder per app, the latest", () => {
      const r = assistantReminders([conn("a", "Claude", -10), conn("b", "Claude", -2)], now);
      expect(r.map((x) => x.id)).toEqual(["b"]);
    });
  });
});
