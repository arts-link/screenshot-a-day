import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { supportedNodeMajor, validateRuntime } from "./check-runtime.mjs";

const root = new URL("../", import.meta.url);

describe("source runtime policy", () => {
  it("accepts Node 24 LTS", () => {
    expect(supportedNodeMajor).toBe(24);
    expect(() => validateRuntime("24.20.0")).not.toThrow();
  });

  it("rejects an untested newer Node major with recovery guidance", () => {
    expect(() => validateRuntime("26.7.0")).toThrow(/Node\.js 24 LTS.*mise trust.*nvm/);
  });

  it("keeps package-manager and version-manager policy aligned", async () => {
    const [manifestBody, mise, nodeVersion, nvm, npmrc] = await Promise.all([
      readFile(new URL("package.json", root), "utf8"),
      readFile(new URL(".mise.toml", root), "utf8"),
      readFile(new URL(".node-version", root), "utf8"),
      readFile(new URL(".nvmrc", root), "utf8"),
      readFile(new URL(".npmrc", root), "utf8"),
    ]);
    const manifest = JSON.parse(manifestBody);

    expect(manifest.engines.node).toBe(">=24.0.0 <25.0.0");
    expect(manifest.engines.pnpm).toBe(">=11.16.0 <12.0.0");
    expect(mise).toContain('node = "24"');
    expect(mise).toContain('pnpm = "11.16.0"');
    expect(nodeVersion.trim()).toBe("24");
    expect(nvm.trim()).toBe("24");
    expect(npmrc.trim()).toBe("engine-strict=true");
  });
});
