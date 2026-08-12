import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, hashToken, safeTokenEqual, signWebhook } from "../src/index.js";

describe("secret helpers", () => {
  it("round-trips encrypted JSON without embedding plaintext", () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = encryptJson({ authorization: "secret" }, key);
    expect(encrypted).not.toContain("secret");
    expect(decryptJson(encrypted, key)).toEqual({ authorization: "secret" });
  });

  it("compares token hashes and signs deterministic webhook payloads", () => {
    const hash = hashToken("token");
    expect(safeTokenEqual("token", hash)).toBe(true);
    expect(safeTokenEqual("other", hash)).toBe(false);
    expect(signWebhook("secret", "100", "{}")).toHaveLength(64);
  });
});
