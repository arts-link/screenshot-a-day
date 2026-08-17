import { describe, expect, it } from "vitest";
import { assertSafeUrl, isPrivateAddress, resolveSafeUrl } from "../src/index.js";

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

  it("returns the vetted addresses so callers can dial them without resolving again", async () => {
    const lookup = async () => [
      { address: "1.1.1.1", family: 4 as const },
      { address: "2606:4700:4700::1111", family: 6 as const },
    ];

    await expect(resolveSafeUrl("https://example.test/path", [], lookup)).resolves.toMatchObject({
      url: new URL("https://example.test/path"),
      addresses: [
        { address: "1.1.1.1", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
    });
  });
});
