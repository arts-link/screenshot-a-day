import { describe, expect, it } from "vitest";
import { assertSafeUrl, isPrivateAddress } from "../src/index.js";

describe("target network policy", () => {
  it("recognizes private and public addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
  });

  it("blocks private DNS answers unless explicitly allowed", async () => {
    const lookup = async () => [{ address: "127.0.0.1", family: 4 as const }];
    await expect(assertSafeUrl("http://internal.test", [], lookup)).rejects.toThrow("blocked");
    await expect(
      assertSafeUrl("http://internal.test", ["internal.test"], lookup),
    ).resolves.toBeInstanceOf(URL);
  });
});
