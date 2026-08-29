import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptJson } from "@sad/core";
import type { AppConfig } from "../src/config.js";
import { AppDatabase } from "../src/database.js";
import { PublicationService, verifyPublicationUrl } from "../src/publication-service.js";

describe("publication target verification", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("rejects a canonical URL that returns 404", async () => {
    const fetcher = vi.fn(async () => new Response("missing", { status: 404 }));
    await expect(
      verifyPublicationUrl(
        "https://wrong.example.com",
        [],
        fetcher as unknown as typeof fetch,
        async (url) => new URL(url),
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      message:
        "Published URL https://wrong.example.com returned HTTP 404. Check the canonical URL or publish the site first.",
    });
  });

  it("validates redirects and accepts a reachable canonical URL", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://gallery.example.com/" },
        }),
      )
      .mockResolvedValueOnce(new Response("gallery", { status: 200 }));
    const validate = vi.fn(async (url: string) => new URL(url));
    await expect(
      verifyPublicationUrl("https://example.com", [], fetcher as unknown as typeof fetch, validate),
    ).resolves.toBeUndefined();
    expect(validate.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/",
      "https://gallery.example.com/",
    ]);
  });

  it("requires both provider access and a reachable URL, then invalidates stale success", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sad-publication-service-"));
    directories.push(directory);
    const encryptionKey = randomBytes(32).toString("base64");
    const db = new AppDatabase(join(directory, "sad.sqlite"));
    const target = db.createPublicationTarget(
      {
        name: "Fixture",
        baseUrl: "https://gallery.example.com",
        scheduleMode: "manual",
        scheduleExpression: null,
        scheduleTimezone: "UTC",
        branding: {
          title: "Fixture",
          description: "",
          logoText: null,
          logoUrl: null,
          tagline: "",
          accentColor: "#dbff53",
          backgroundColor: "#10151d",
          darkMode: true,
          supplementalFooter: "",
          analytics: { provider: "none" },
        },
        target: {
          adapter: "vercel",
          config: { projectId: "fixture", teamId: null },
          credentials: { token: "fixture-token" },
        },
      },
      encryptJson({ token: "fixture-token" }, encryptionKey),
      null,
    );
    const adapterVerify = vi.fn(async () => undefined);
    const verifyPublicUrl = vi.fn(async () => undefined);
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 4400,
      dataDir: directory,
      publicUrl: "http://localhost:4400",
      encryptionKey,
      sessionSecret: "s".repeat(32),
      workerToken: "w".repeat(32),
      privateTargetAllowlist: [],
      trustProxy: false,
      buildCommit: "test",
      publicationDeployTimeoutMs: 30_000,
      logLevel: "silent",
    };
    const service = new PublicationService({
      db,
      config,
      renderer: {
        id: "static-gallery",
        verify: async () => ({ available: true, error: null }),
        render: async () => {
          throw new Error("not used");
        },
      },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      adapterFor: () => ({
        verify: adapterVerify,
        deploy: async () => {
          throw new Error("not used");
        },
      }),
      verifyPublicUrl,
    });

    await service.verifyTarget(target);
    expect(adapterVerify).toHaveBeenCalledOnce();
    expect(verifyPublicUrl).toHaveBeenCalledWith("https://gallery.example.com", []);
    expect(db.getPublicationTarget(target.id)?.last_verified_at).not.toBeNull();

    db.updatePublicationTarget(target.id, { baseUrl: "https://changed.example.com" });
    expect(db.getPublicationTarget(target.id)).toMatchObject({
      base_url: "https://changed.example.com",
      last_verified_at: null,
      last_verification_error: null,
    });
    db.close();
  });
});
