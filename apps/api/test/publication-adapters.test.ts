import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicationTargetRow } from "../src/database.js";
import { NetlifyAdapter, SftpAdapter, VercelAdapter } from "../src/publication-adapters.js";
import type { ManagedFile, RenderedPublication } from "../src/publication-renderer.js";

function target(adapter: "vercel" | "netlify" | "sftp", config: unknown): PublicationTargetRow {
  return {
    id: "target-fixture",
    name: "Fixture",
    adapter,
    base_url: "https://history.example.com",
    branding_json: "{}",
    schedule_mode: "manual",
    schedule_expression: null,
    schedule_timezone: "UTC",
    adapter_config_json: JSON.stringify(config),
    credentials_encrypted: "redacted",
    dirty_revision: 1,
    published_revision: 0,
    next_run_at: null,
    last_verified_at: null,
    last_verification_error: null,
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z",
  };
}

describe("publication adapters", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function siteFixture(): Promise<RenderedPublication> {
    const directory = await mkdtemp(join(tmpdir(), "sad-adapter-test-"));
    directories.push(directory);
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<html>fixture</html>");
    await writeFile(join(directory, "assets", "app.js"), "fixture");
    const files: ManagedFile[] = [
      {
        path: "index.html",
        sha256: createHash("sha256").update("<html>fixture</html>").digest("hex"),
        sha1: createHash("sha1").update("<html>fixture</html>").digest("hex"),
        size: 20,
      },
      {
        path: "assets/app.js",
        sha256: createHash("sha256").update("fixture").digest("hex"),
        sha1: createHash("sha1").update("fixture").digest("hex"),
        size: 7,
      },
    ];
    return { directory, files, cleanup: async () => undefined };
  }

  it("uploads missing Vercel files by digest and creates a production deployment", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      if (String(url).includes("/v13/deployments"))
        return Response.json({ id: "dpl_1", url: "fixture.vercel.app" });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const adapter = new VercelAdapter(fetcher);
    const site = await siteFixture();
    const result = await adapter.deploy(
      target("vercel", { projectId: "prj_fixture", teamId: "team_fixture" }),
      { token: "secret-token" },
      site,
      [],
    );
    expect(result).toEqual({ deploymentId: "dpl_1", deploymentUrl: "https://fixture.vercel.app" });
    expect(calls.filter((call) => call.url.includes("/v2/files"))).toHaveLength(2);
    expect(
      (
        calls.find((call) => call.url.includes("/v2/files"))!.init!.headers as Record<
          string,
          string
        >
      )["x-vercel-digest"],
    ).toBe(site.files[0]!.sha1);
    const deploymentBody = JSON.parse(
      String(calls.find((call) => call.url.includes("/v13/deployments"))!.init!.body),
    );
    expect(deploymentBody).toMatchObject({ project: "prj_fixture", target: "production" });
    expect(JSON.stringify(calls)).not.toContain("credentials_encrypted");
  });

  it("uses Netlify's digest response to upload only missing files", async () => {
    const site = await siteFixture();
    const missing = site.files[0]!.sha1;
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/deploys"))
        return Response.json({
          id: "deploy-1",
          ssl_url: "https://fixture.netlify.app",
          required: [missing],
        });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const result = await new NetlifyAdapter(fetcher).deploy(
      target("netlify", { siteId: "site-fixture" }),
      { token: "secret-token" },
      site,
      [],
    );
    expect(result.deploymentId).toBe("deploy-1");
    expect(calls.filter((call) => call.startsWith("PUT"))).toHaveLength(1);
    expect(calls.find((call) => call.startsWith("PUT"))).toContain("index.html");
  });

  it("pins SFTP address and host key, swaps pages, and preserves unknown files", async () => {
    const site = await siteFixture();
    const operations: string[] = [];
    const hostKey = Buffer.from("fixture-host-key");
    const hostKeyFingerprint = createHash("sha256")
      .update(hostKey)
      .digest("base64")
      .replace(/=$/, "");
    const remote = new Set([
      "/srv/history",
      "/srv/history/.screenshot-a-day-target.json",
      "/srv/history/stale.html",
      "/srv/history/unknown.txt",
    ]);
    const fake = {
      connect: vi.fn(async (config: Record<string, unknown>) => {
        operations.push(`connect:${String(config.host)}`);
        expect((config.hostVerifier as (key: Buffer) => boolean)(hostKey)).toBe(true);
      }),
      end: vi.fn(async () => undefined),
      list: vi.fn(async () => [
        { name: ".screenshot-a-day-target.json", type: "-" },
        { name: "unknown.txt", type: "-" },
      ]),
      realPath: vi.fn(async (path: string) => path),
      exists: vi.fn(async (path: string) => remote.has(path)),
      get: vi.fn(async () => Buffer.from(JSON.stringify({ targetId: "target-fixture" }))),
      put: vi.fn(async (_source: Buffer | string, path: string) => {
        operations.push(`put:${path}`);
        remote.add(path);
        return path;
      }),
      mkdir: vi.fn(async (path: string) => {
        remote.add(path);
        return path;
      }),
      delete: vi.fn(async (path: string) => {
        operations.push(`delete:${path}`);
        remote.delete(path);
        return path;
      }),
      rename: vi.fn(async () => ""),
      posixRename: vi.fn(async (from: string, to: string) => {
        operations.push(`rename:${from}:${to}`);
        remote.delete(from);
        remote.add(to);
        return to;
      }),
    };
    const resolver = vi.fn(async () => ({
      url: new URL("https://sftp.example.com"),
      addresses: [{ address: "203.0.113.10", family: 4 as const }],
    }));
    const adapter = new SftpAdapter([], () => fake as never, resolver);
    await adapter.deploy(
      target("sftp", {
        host: "sftp.example.com",
        port: 22,
        root: "/srv/history",
        username: "publisher",
        hostKeySha256: `SHA256:${hostKeyFingerprint}`,
      }),
      { kind: "password", password: "secret" },
      site,
      [{ path: "stale.html", sha256: "old", sha1: "old", size: 1 }],
    );
    expect(operations[0]).toBe("connect:203.0.113.10");
    expect(operations).toContain("delete:/srv/history/stale.html");
    expect(operations).not.toContain("delete:/srv/history/unknown.txt");
    expect(operations.at(-1)).toContain("rename:/srv/history/index.html.sad-");
  });
});
