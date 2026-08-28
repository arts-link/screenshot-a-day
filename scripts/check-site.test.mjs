import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./check-site.mjs";

describe("site metadata validation", () => {
  it("matches the canonical hostname literally", () => {
    const pattern = new RegExp(escapeRegExp("https://arts-link.github.io/screenshot-a-day/"));
    expect(pattern.test("https://arts-link.github.io/screenshot-a-day/")).toBe(true);
    expect(pattern.test("https://arts-linkXgithubYio/screenshot-a-day/")).toBe(false);
  });
});
