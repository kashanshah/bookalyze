import { describe, expect, it } from "vitest";
import {
  ASSISTANTS,
  assistantFor,
  CHAT_ASSISTANTS,
  DEVELOPER_TOOLS,
  examplePrompts,
  mcpUrl,
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
});
