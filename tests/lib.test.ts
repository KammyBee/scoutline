import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, daysBetween, todayIn } from "@/lib/dates";
import { dedupeKey, slugify } from "@/lib/dedupe";
import { isRemoteUS, payText } from "@/lib/jobView";
import { createSessionToken, passwordMatches, sessionValid } from "@/lib/session";
import type { JobRow } from "@/lib/types";

describe("dedupe", () => {
  it("treats company suffixes, case and punctuation as the same role", () => {
    expect(dedupeKey("Acme, Inc.", "ERP Developer (Remote)")).toBe(dedupeKey("acme", "erp developer remote"));
    expect(dedupeKey("Cash App", "BSA")).not.toBe(dedupeKey("Block", "BSA"));
  });
  it("slugifies ids", () => {
    expect(slugify("City & County of SF — 1052 Analyst!")).toBe("city-county-of-sf-1052-analyst");
  });
});

describe("dates", () => {
  it("uses your time zone for today", () => {
    expect(todayIn("America/Los_Angeles", new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-01");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-10-29", 7)).toBe("2026-11-05");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
  });
});

describe("job view helpers", () => {
  const base = { payText: null, payMin: 110000, payMax: 140000, mode: "remote", tags: [], status: "new", posted: "2026-10-25" } as unknown as JobRow;
  it("formats pay", () => expect(payText(base)).toBe("$110k–$140k"));
  it("drops stale remote postings you haven't applied to", () => {
    expect(isRemoteUS(base, "2026-11-01")).toBe(true);
    expect(isRemoteUS({ ...base, posted: "2026-09-01" }, "2026-11-01")).toBe(false);
    expect(isRemoteUS({ ...base, posted: "2026-09-01", status: "applied" }, "2026-11-01")).toBe(true);
  });
});

describe("session", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts only the right password and a fresh, untampered token", async () => {
    vi.stubEnv("APP_PASSWORD", "correct horse");
    vi.stubEnv("SESSION_SECRET", "x".repeat(40));
    expect(await passwordMatches("correct horse")).toBe(true);
    expect(await passwordMatches("wrong")).toBe(false);
    const now = Date.now();
    const token = await createSessionToken(now);
    expect(await sessionValid(token, now)).toBe(true);
    expect(await sessionValid(token.replace(/.$/, (c) => (c === "a" ? "b" : "a")), now)).toBe(false);
    expect(await sessionValid(token, now + 31 * 864e5)).toBe(false);
  });
});
