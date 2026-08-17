import { describe, expect, it } from "vitest";

import { validateRelease } from "./check-release.mjs";

const valid = {
  tag: "v0.1.0",
  version: "0.1.0",
  objectType: "tag",
  taggedCommit: "abc123",
  mainCommit: "abc123",
};

describe("release tag validation", () => {
  it("accepts an annotated matching tag at the main tip", () => {
    expect(() => validateRelease(valid)).not.toThrow();
  });

  it("rejects a mismatched version", () => {
    expect(() => validateRelease({ ...valid, tag: "v0.1.1" })).toThrow(/exactly equal/);
  });

  it("rejects a lightweight tag", () => {
    expect(() => validateRelease({ ...valid, objectType: "commit" })).toThrow(/lightweight/);
  });

  it("rejects a tag that is not at the current main tip", () => {
    expect(() => validateRelease({ ...valid, mainCommit: "def456" })).toThrow(
      /current origin\/main/,
    );
  });

  it("accepts an exact prerelease and does not infer a stable alias", () => {
    expect(() =>
      validateRelease({ ...valid, tag: "v0.2.0-rc.1", version: "0.2.0-rc.1" }),
    ).not.toThrow();
  });
});
