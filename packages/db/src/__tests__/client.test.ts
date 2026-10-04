import { describe, expect, it } from "vitest";
import { withVerifiedSsl } from "../client";

describe("database URLs", () => {
  it("asks for full certificate verification instead of the weaker aliases", () => {
    const host = "postgres://user:pw@db.example/app";
    expect(withVerifiedSsl(`${host}?sslmode=require`)).toBe(`${host}?sslmode=verify-full`);
    expect(withVerifiedSsl(`${host}?channel_binding=require&sslmode=require`)).toBe(
      `${host}?channel_binding=require&sslmode=verify-full`,
    );
    expect(withVerifiedSsl(`${host}?sslmode=prefer&x=1`)).toBe(`${host}?sslmode=verify-full&x=1`);
    expect(withVerifiedSsl(`${host}?sslmode=disable`)).toBe(`${host}?sslmode=disable`);
    expect(withVerifiedSsl("postgres://localhost:5432/app")).toBe("postgres://localhost:5432/app");
  });
});
