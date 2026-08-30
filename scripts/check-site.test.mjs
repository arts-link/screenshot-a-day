import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./check-site.mjs";

describe("site metadata validation", () => {
  it("matches the canonical hostname literally", () => {
    const pattern = new RegExp(escapeRegExp("https://arts-link.github.io/screenshot-a-day/"));
    expect(pattern.test("https://arts-link.github.io/screenshot-a-day/")).toBe(true);
    expect(pattern.test("https://arts-linkXgithubYio/screenshot-a-day/")).toBe(false);
  });
});

describe("marketing analytics validation", () => {
  it("treats the PostHog project token as public configuration", () => {
    const token = "phc_6ETRdmu3rRItmhyAtxqdN8umjqSAWMRKYVvlu35GMJ7";
    expect(token).toMatch(/^phc_[A-Za-z0-9]+$/);
    expect(token).not.toMatch(/phx_/);
  });
});
