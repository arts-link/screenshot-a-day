import { describe, expect, it } from "vitest";
import { nextSchedule, shouldCoalesce } from "../src/index.js";

describe("scheduling", () => {
  it("evaluates cron expressions in an IANA timezone", () => {
    const next = nextSchedule("0 0 * * *", "America/Los_Angeles", new Date("2026-08-12T12:00:00Z"));
    expect(next.toISOString()).toBe("2026-08-13T07:00:00.000Z");
  });

  it("coalesces only active scheduled work", () => {
    expect(shouldCoalesce(["succeeded", "failed"])).toBe(false);
    expect(shouldCoalesce(["queued"])).toBe(true);
  });
});
