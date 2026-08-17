import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@sad/core";
import { buildApp, drainBlobDeletions } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { AppDatabase } from "../src/database.js";
import { LocalBlobStore } from "../src/storage.js";
import type { FastifyInstance } from "fastify";

describe("control plane", () => {
  let directory: string;
  let db: AppDatabase;
  let app: FastifyInstance;
  let blobs: LocalBlobStore;
  const sessionToken = "administrator-session-token";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "sad-api-test-"));
    db = new AppDatabase(join(directory, "test.sqlite"));
    const user = db.createUser("admin@example.com", "unused-in-this-test");
    db.createSession(user.id, hashToken(sessionToken), new Date(Date.now() + 60_000));
    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      dataDir: directory,
      publicUrl: "http://localhost:4400",
      encryptionKey: randomBytes(32).toString("base64"),
      sessionSecret: "s".repeat(32),
      workerToken: "w".repeat(32),
      privateTargetAllowlist: ["localhost"],
      trustProxy: false,
      buildCommit: "test-commit",
      logLevel: "silent",
    };
    blobs = new LocalBlobStore(join(directory, "blobs"));
    app = await buildApp({ config, db, blobs });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function createFixtureProject(slug: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: `sad_session=${sessionToken}` },
      payload: {
        name: `Fixture ${slug}`,
        slug,
        url: "http://localhost:9999",
        headers: { "x-old": "secret" },
        cookies: [],
        profiles: [
          {
            name: "Desktop",
            browser: "chromium",
            enabled: true,
            viewportWidth: 1440,
            viewportHeight: 900,
            deviceScaleFactor: 1,
            extent: "viewport",
            colorScheme: "light",
            locale: "en-US",
            timezone: "UTC",
            reducedMotion: "reduce",
            delayMs: 1000,
            timeoutMs: 30000,
          },
        ],
      },
    });
  }

  it("reports health and exact version information", async () => {
    expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/version" })).json()).toEqual({
      version: "0.1.0",
      commit: "test-commit",
      apiVersion: "v1",
    });
  });

  it("creates a project, leases its capture, and records a failure", async () => {
    const cookie = `sad_session=${sessionToken}`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: {
        name: "Fixture",
        slug: "fixture",
        url: "http://localhost:9999",
        publishMode: "private",
        scheduleExpression: "0 0 * * *",
        scheduleTimezone: "UTC",
        scheduleEnabled: false,
        retentionDays: null,
        retentionCount: null,
        headers: { "x-test": "secret" },
        cookies: [],
        profiles: [
          {
            name: "Desktop",
            browser: "chromium",
            enabled: true,
            deviceName: null,
            viewportWidth: 1440,
            viewportHeight: 900,
            deviceScaleFactor: 1,
            extent: "viewport",
            colorScheme: "light",
            locale: "en-US",
            timezone: "UTC",
            reducedMotion: "reduce",
            delayMs: 1000,
            waitForSelector: null,
            timeoutMs: 30000,
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json<{ id: string }>();
    const trigger = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/runs`,
      headers: { cookie, "idempotency-key": "deploy-1" },
      payload: {},
    });
    expect(trigger.statusCode).toBe(202);
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/runs`,
      headers: { cookie, "idempotency-key": "deploy-1" },
      payload: {},
    });
    expect(duplicate.json()).toEqual(trigger.json());
    const runs = await app.inject({
      url: `/api/v1/projects/${project.id}/runs`,
      headers: { cookie },
    });
    expect(runs.json()).toMatchObject([
      { id: trigger.json<{ runId: string }>().runId, status: "queued", capture_job_count: 1 },
    ]);

    let job!: { id: string; leaseToken: string; headers: Record<string, string> };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = await app.inject({
        method: "POST",
        url: "/internal/v1/jobs/claim",
        headers: { authorization: `Bearer ${"w".repeat(32)}` },
      });
      expect(claim.statusCode).toBe(200);
      job = claim.json();
      expect(job.headers).toEqual({ "x-test": "secret" });
      const failure = await app.inject({
        method: "POST",
        url: `/internal/v1/jobs/${job.id}/failure`,
        headers: { authorization: `Bearer ${"w".repeat(32)}` },
        payload: {
          leaseToken: job.leaseToken,
          capturedAt: new Date().toISOString(),
          error: "fixture unavailable",
          finalUrl: null,
          durationMs: 5,
        },
      });
      expect(failure.statusCode).toBe(attempt < 3 ? 202 : 201);
      db.raw
        .prepare("UPDATE jobs SET available_at=? WHERE id=?")
        .run(new Date(0).toISOString(), job.id);
    }
    const captures = await app.inject({
      url: `/api/v1/projects/${project.id}/captures`,
      headers: { cookie },
    });
    expect(captures.json<Array<{ status: string; error: string }>>()).toMatchObject([
      { status: "failed", error: "fixture unavailable" },
    ]);
  });

  it("rejects unauthenticated administration", async () => {
    expect((await app.inject({ url: "/api/v1/projects" })).statusCode).toBe(401);
  });

  it("renews an active worker lease without changing its token", async () => {
    const created = await createFixtureProject("lease-renewal");
    const project = created.json<{ id: string }>();
    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/runs`,
      headers: { cookie: `sad_session=${sessionToken}` },
      payload: {},
    });
    const claim = await app.inject({
      method: "POST",
      url: "/internal/v1/jobs/claim",
      headers: { authorization: `Bearer ${"w".repeat(32)}` },
    });
    const job = claim.json<{ id: string; leaseToken: string }>();
    const before = new Date(Date.now() + 1_000).toISOString();
    db.raw.prepare("UPDATE jobs SET lease_expires_at=? WHERE id=?").run(before, job.id);

    const renewed = await app.inject({
      method: "POST",
      url: `/internal/v1/jobs/${job.id}/renew`,
      headers: { authorization: `Bearer ${"w".repeat(32)}` },
      payload: { leaseToken: job.leaseToken },
    });
    expect(renewed.statusCode).toBe(200);
    expect(
      new Date(renewed.json<{ leaseExpiresAt: string }>().leaseExpiresAt).getTime(),
    ).toBeGreaterThan(Date.now() + 100_000);

    const rejected = await app.inject({
      method: "POST",
      url: `/internal/v1/jobs/${job.id}/renew`,
      headers: { authorization: `Bearer ${"w".repeat(32)}` },
      payload: { leaseToken: "wrong-token" },
    });
    expect(rejected.statusCode).toBe(409);
  });

  it("coalesces queued exports and prevents stale jobs from replacing the latest artifact", async () => {
    const created = await createFixtureProject("coalesced-exports");
    const project = created.json<{ id: string; profiles: Array<{ id: string }> }>();
    const profileId = project.profiles[0]!.id;
    const payload = (captureIds: string[]) => ({
      format: "gif" as const,
      captureIds,
      frameDurationMs: 750,
      canvasWidth: 1280,
      canvasHeight: 720,
      timestampOverlay: true,
      background: "#111827",
    });

    const firstId = db.enqueueExport(project.id, profileId, "gif", payload(["old"]));
    const coalescedId = db.enqueueExport(project.id, profileId, "gif", payload(["new"]));
    expect(coalescedId).toBe(firstId);
    expect(
      JSON.parse(
        (
          db.raw.prepare("SELECT payload_json FROM jobs WHERE id=?").get(firstId) as {
            payload_json: string;
          }
        ).payload_json,
      ),
    ).toMatchObject({ captureIds: ["new"] });

    const first = db.claimJob();
    expect(first?.id).toBe(firstId);
    const secondId = db.enqueueExport(project.id, profileId, "gif", payload(["newest"]));
    expect(secondId).not.toBe(firstId);
    expect(db.enqueueExport(project.id, profileId, "gif", payload(["final"]))).toBe(secondId);
    expect(
      db.raw
        .prepare(
          "SELECT count(*) count FROM jobs WHERE profile_id=? AND type='export' AND status IN ('queued','leased')",
        )
        .get(profileId),
    ).toEqual({ count: 2 });

    expect(db.saveExport(first!, "exports/old.gif", 1).published).toBe(false);
    expect(db.getExport(profileId, "gif")?.blob_key).toBeNull();
    const second = db.claimJob();
    expect(second?.id).toBe(secondId);
    expect(db.saveExport(second!, "exports/new.gif", 2).published).toBe(true);
    expect(db.getExport(profileId, "gif")).toMatchObject({
      blob_key: "exports/new.gif",
      frame_count: 2,
      status: "succeeded",
    });
  });

  it("deletes profile and project artifacts through the durable cleanup queue", async () => {
    const created = await createFixtureProject("artifact-cleanup");
    const project = created.json<{ id: string; profiles: Array<{ id: string }> }>();
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/profiles`,
      headers: { cookie: `sad_session=${sessionToken}` },
      payload: {
        name: "Mobile",
        browser: "chromium",
        enabled: true,
        viewportWidth: 390,
        viewportHeight: 844,
        deviceScaleFactor: 1,
        extent: "viewport",
        colorScheme: "light",
        locale: "en-US",
        timezone: "UTC",
        reducedMotion: "reduce",
        delayMs: 0,
        timeoutMs: 30000,
      },
    });
    const secondProfileId = added.json<{ id: string }>().id;

    const seedArtifacts = async (profileId: string, prefix: string) => {
      const runId = db.enqueueRun(project.id, "manual", [profileId]);
      const job = db.claimJob()!;
      expect(job.run_id).toBe(runId);
      const keys = [`${prefix}/image.png`, `${prefix}/thumbnail.webp`, `${prefix}/diff.png`];
      await Promise.all(keys.map((key) => blobs.put(key, Buffer.from(key))));
      db.recordCapture(job, {
        status: "succeeded",
        captured_at: new Date().toISOString(),
        final_url: "http://localhost:9999",
        http_status: 200,
        width: 1,
        height: 1,
        sha256: "digest",
        change_percent: 0,
        image_key: keys[0]!,
        thumbnail_key: keys[1]!,
        diff_key: keys[2]!,
        error: null,
        duration_ms: 1,
      });
      const exportId = db.enqueueExport(project.id, profileId, "gif", {
        format: "gif",
        captureIds: [],
      });
      const exportJob = db.claimJob()!;
      expect(exportJob.id).toBe(exportId);
      const exportKey = `${prefix}/animation.gif`;
      await blobs.put(exportKey, Buffer.from("gif"));
      db.saveExport(exportJob, exportKey, 1);
      return [...keys, exportKey];
    };

    const profileKeys = await seedArtifacts(secondProfileId, "profile-artifacts");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/projects/${project.id}/profiles/${secondProfileId}`,
          headers: { cookie: `sad_session=${sessionToken}` },
        })
      ).statusCode,
    ).toBe(204);
    for (const key of profileKeys) await expect(blobs.get(key)).rejects.toThrow();

    const projectKeys = await seedArtifacts(project.profiles[0]!.id, "project-artifacts");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/projects/${project.id}`,
          headers: { cookie: `sad_session=${sessionToken}` },
        })
      ).statusCode,
    ).toBe(204);
    for (const key of projectKeys) await expect(blobs.get(key)).rejects.toThrow();
    expect(db.pendingBlobDeletions()).toEqual([]);
  });

  it("retains failed blob deletions for a later retry", async () => {
    db.queueBlobDeletion("retry/artifact.png");
    const remove = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(undefined);

    await drainBlobDeletions(db, { delete: remove } as never);
    expect(db.pendingBlobDeletions()).toEqual(["retry/artifact.png"]);
    await drainBlobDeletions(db, { delete: remove } as never);
    expect(db.pendingBlobDeletions()).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("keeps target credentials write-only and supports complete profile editing", async () => {
    const cookie = `sad_session=${sessionToken}`;
    const created = await createFixtureProject("managed");
    expect(created.statusCode).toBe(201);
    const project = created.json<{ id: string; profiles: Array<{ id: string }> }>();
    expect(JSON.stringify(project)).not.toContain("secret");

    const credentials = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/credentials`,
      headers: { cookie },
      payload: { headers: { "x-new": "replacement" }, cookies: [] },
    });
    expect(credentials.statusCode).toBe(204);

    const profile = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/profiles/${project.profiles[0]!.id}`,
      headers: { cookie },
      payload: {
        name: "Full page dark",
        browser: "firefox",
        enabled: true,
        viewportWidth: 1280,
        viewportHeight: 720,
        deviceScaleFactor: 2,
        extent: "fullPage",
        colorScheme: "dark",
        locale: "en-GB",
        timezone: "Europe/London",
        reducedMotion: "reduce",
        delayMs: 250,
        timeoutMs: 45000,
      },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      name: "Full page dark",
      browser: "firefox",
      settings: { extent: "fullPage", colorScheme: "dark", deviceScaleFactor: 2 },
    });

    const guardedSchedule = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload: { scheduleEnabled: true },
    });
    expect(guardedSchedule.statusCode).toBe(409);
    const confirmedSchedule = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload: { scheduleEnabled: true, confirmUntestedProfiles: true },
    });
    expect(confirmedSchedule.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/runs`,
      headers: { cookie },
      payload: {},
    });
    const claim = await app.inject({
      method: "POST",
      url: "/internal/v1/jobs/claim",
      headers: { authorization: `Bearer ${"w".repeat(32)}` },
    });
    expect(claim.json()).toMatchObject({ headers: { "x-new": "replacement" } });
    expect(
      JSON.stringify(
        await app
          .inject({ url: `/api/v1/projects/${project.id}`, headers: { cookie } })
          .then((reply) => reply.json()),
      ),
    ).not.toContain("replacement");
  });

  it("creates scoped bearer tokens and revokes them", async () => {
    const cookie = `sad_session=${sessionToken}`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tokens",
      headers: { cookie },
      payload: { name: "CI", scopes: ["read"], projectIds: null },
    });
    expect(created.statusCode).toBe(201);
    const token = created.json<{ id: string; token: string }>();
    expect(
      (
        await app.inject({
          url: "/api/v1/projects",
          headers: { authorization: `Bearer ${token.token}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/tokens/${token.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          url: "/api/v1/projects",
          headers: { authorization: `Bearer ${token.token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("prevents project-scoped tokens from escaping their authorization boundary", async () => {
    const cookie = `sad_session=${sessionToken}`;
    const first = await createFixtureProject("scoped-first");
    const second = await createFixtureProject("scoped-second");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstId = first.json<{ id: string }>().id;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tokens",
      headers: { cookie },
      payload: {
        name: "Project automation",
        scopes: ["read", "manage"],
        projectIds: [firstId],
      },
    });
    const token = created.json<{ token: string }>().token;
    const authorization = { authorization: `Bearer ${token}` };

    const projects = await app.inject({ url: "/api/v1/projects", headers: authorization });
    expect(projects.statusCode).toBe(200);
    expect(projects.json<Array<{ id: string }>>().map((project) => project.id)).toEqual([firstId]);

    for (const request of [
      app.inject({ url: "/api/v1/tokens", headers: authorization }),
      app.inject({ url: "/api/v1/storage", headers: authorization }),
      app.inject({
        method: "POST",
        url: "/api/v1/tokens",
        headers: authorization,
        payload: { name: "Escalated", scopes: ["manage"], projectIds: null },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: authorization,
        payload: {
          name: "Unauthorized",
          slug: "unauthorized",
          url: "http://localhost:9999",
          profiles: [{ name: "Desktop" }],
        },
      }),
    ]) {
      expect((await request).statusCode).toBe(401);
    }
  });

  it("returns a client error for blocked target addresses", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: `sad_session=${sessionToken}` },
      payload: {
        name: "Blocked",
        slug: "blocked",
        url: "http://127.0.0.1",
        profiles: [{ name: "Desktop" }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("blocked");
  });
});
