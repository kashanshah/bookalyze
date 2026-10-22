import { describe, expect, it } from "vitest";
import { GET } from "./route";

const ask = (country?: string) =>
  GET(
    new Request("https://bookalyze.com/api/region", {
      headers: country ? { "x-vercel-ip-country": country } : {},
    }),
  ).json();

describe("/api/region", () => {
  it("asks visitors in the EU, the UK and Switzerland, and nobody else", async () => {
    expect(await ask("DE")).toEqual({ consent: true });
    expect(await ask("GB")).toEqual({ consent: true });
    expect(await ask("CH")).toEqual({ consent: true });
    expect(await ask("CA")).toEqual({ consent: false });
    expect(await ask("AE")).toEqual({ consent: false });
    expect(await ask()).toEqual({ consent: false });
  });
  it("isn't cached", () => {
    const res = GET(new Request("https://bookalyze.com/api/region"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
