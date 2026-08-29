import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, parseBearerToken, SetupManager, verifyPassword } from "../src/auth.js";

afterEach(() => vi.useRealTimers());

describe("administrator authentication", () => {
  it("accepts a setup token once and expires it after fifteen minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00Z"));
    const first = new SetupManager();
    const token = first.issue();
    expect(first.consume(token)).toBe(true);
    expect(first.consume(token)).toBe(false);

    const expired = new SetupManager();
    const expiredToken = expired.issue();
    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(expired.consume(expiredToken)).toBe(false);
  });

  it("hashes administrator passwords with a one-way Argon2id envelope", async () => {
    const hash = await hashPassword("a sufficiently long password");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "a sufficiently long password")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("parses bearer credentials without a backtracking regular expression", () => {
    expect(parseBearerToken("Bearer token-value")).toBe("token-value");
    expect(parseBearerToken("bEaReR\t\ttoken-value")).toBe("token-value");
    expect(parseBearerToken("Basic token-value")).toBeNull();
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer token value")).toBeNull();
    expect(parseBearerToken(`Bearer ${" ".repeat(8192)}x`)).toBeNull();
  });
});
