import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@sad/core";
import sharp from "sharp";
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
      publicationDeployTimeoutMs: 30_000,
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

  async function createVercelTarget(name = "Static history") {
    return app.inject({
      method: "POST",
      url: "/api/v1/publication-targets",
      headers: { cookie: `sad_session=${sessionToken}` },
      payload: {
        name,
        baseUrl: "https://history.example.com",
        scheduleMode: "manual",
        scheduleExpression: null,
        scheduleTimezone: "UTC",
        branding: {
          title: "Visual history",
          description: "Retained screenshots",
          logoText: "History",
          logoUrl: null,
          tagline: "Recorded over time",
          accentColor: "#dbff53",
          backgroundColor: "#10151d",
          darkMode: true,
          supplementalFooter: "Example studio",
          analytics: { provider: "none" },
        },
        target: {
          adapter: "vercel",
          config: { projectId: "prj_fixture", teamId: null },
          credentials: { token: "vercel-secret-token" },
        },
      },
    });
  }

  async function seedCapture(
    projectId: string,
    profileId: string,
    status: "succeeded" | "failed",
    capturedAt: string,
    color = "#000000",
  ) {
    db.enqueueRun(projectId, "manual", [profileId]);
    const job = db.claimJob()!;
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: color },
    })
      .png()
      .toBuffer();
    const imageKey = `test/${job.id}.png`;
    const thumbnailKey = `test/${job.id}.webp`;
    await Promise.all([blobs.put(imageKey, bytes), blobs.put(thumbnailKey, bytes)]);
    return db.recordCapture(job, {
      status,
      captured_at: capturedAt,
      final_url: "http://localhost:9999",
      http_status: status === "succeeded" ? 200 : null,
      width: 20,
      height: 20,
      sha256: status === "succeeded" ? `${job.id}-digest` : null,
      change_percent: status === "succeeded" ? 0 : null,
      image_key: imageKey,
      thumbnail_key: thumbnailKey,
      diff_key: null,
      error: status === "failed" ? "diagnostic failure" : null,
      duration_ms: 1,
    });
  }

  it("reports health and exact version information", async () => {
    const health = await app.inject({ url: "/health/ready" });
    expect(health.statusCode).toBe(200);
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(health.headers["x-frame-options"]).toBe("DENY");
    expect(health.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect((await app.inject({ url: "/version" })).json()).toEqual({
      version: "0.1.0",
      commit: "test-commit",
      apiVersion: "v1",
    });
  });

  it("applies forward migration 2 and never returns publication credentials", async () => {
    expect(db.raw.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
    ]);
    const created = await createVercelTarget();
    expect(created.statusCode, created.body).toBe(201);
    expect(created.body).not.toContain("vercel-secret-token");
    expect(created.json()).toMatchObject({
      adapter: "vercel",
      credentialConfigured: true,
      state: "published",
    });
    expect(
      db.getPublicationTarget(created.json<{ id: string }>().id)?.credentials_encrypted,
    ).not.toContain("vercel-secret-token");
  });

  it("keeps the built-in gallery as fallback until static handoff and reports pending removals", async () => {
    const projectResponse = await createFixtureProject("static-handoff");
    const project = projectResponse.json<{ id: string }>();
    const cookie = `sad_session=${sessionToken}`;
    await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie },
      payload: { publishMode: "indexable" },
    });
    const target = (await createVercelTarget()).json<{ id: string }>();
    const attached = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/static-publication`,
      headers: { cookie },
      payload: { targetId: target.id },
    });
    expect(attached.statusCode).toBe(201);
    expect(attached.json()).toMatchObject({ state: "pending", active: false });
    expect((await app.inject({ url: "/api/public/p/static-handoff" })).statusCode).toBe(200);

    db.enqueuePublication(target.id);
    const job = db.claimPublicationJob()!;
    db.completePublicationJob(job, {
      deploymentId: "dpl_fixture",
      deploymentUrl: "https://history.example.com",
      manifest: { files: [] },
    });
    expect((await app.inject({ url: "/api/public/p/static-handoff" })).statusCode).toBe(404);
    const detail = await app.inject({
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
    });
    expect(detail.json()).toMatchObject({
      staticPublication: {
        active: true,
        url: "https://history.example.com/p/static-handoff/",
      },
    });

    const privateResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie },
      payload: { publishMode: "private" },
    });
    expect(privateResponse.json()).toMatchObject({
      staticPublication: { state: "removal_pending" },
    });
    expect(db.listPublicationJobs(target.id, 1)[0]).toMatchObject({
      operation: "remove",
      status: "queued",
    });
    const detached = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/static-publication`,
      headers: { cookie },
    });
    expect(detached.statusCode).toBe(202);
  });

  it("publishes immediately on attach and never labels public visibility changes as removal", async () => {
    const project = (await createFixtureProject("publication-transitions")).json<{ id: string }>();
    const target = (await createVercelTarget()).json<{ id: string }>();
    const cookie = `sad_session=${sessionToken}`;
    const attached = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/static-publication`,
      headers: { cookie },
      payload: { targetId: target.id },
    });
    expect(attached.json()).toMatchObject({
      targetName: "Static history",
      targetAdapter: "vercel",
      latestJob: { operation: "publish", status: "queued" },
    });
    const initialJob = db.claimPublicationJob()!;
    db.completePublicationJob(initialJob, {
      deploymentId: "dpl_private",
      deploymentUrl: "https://history.example.com",
      manifest: { files: [] },
    });

    const publicResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie },
      payload: { publishMode: "indexable" },
    });
    expect(publicResponse.json()).toMatchObject({
      staticPublication: {
        state: "active",
        latestJob: { operation: "publish", status: "queued" },
      },
    });

    await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie },
      payload: { publishMode: "private" },
    });
    expect(db.listPublicationJobs(target.id, 1)[0]).toMatchObject({ operation: "remove" });

    const restored = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie },
      payload: { publishMode: "unlisted" },
    });
    expect(restored.json()).toMatchObject({
      staticPublication: {
        state: "active",
        latestJob: { operation: "publish", status: "queued" },
      },
    });
  });

  it("makes public projects private during normal detach and supports force detach", async () => {
    const cookie = `sad_session=${sessionToken}`;
    const target = (await createVercelTarget()).json<{ id: string }>();
    const project = (await createFixtureProject("detach-directly")).json<{ id: string }>();
    await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie },
      payload: { publishMode: "indexable" },
    });
    await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/static-publication`,
      headers: { cookie },
      payload: { targetId: target.id },
    });
    const publishJob = db.claimPublicationJob()!;
    db.completePublicationJob(publishJob, {
      deploymentId: "dpl_public",
      deploymentUrl: "https://history.example.com",
      manifest: { files: [] },
    });

    const detached = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/static-publication`,
      headers: { cookie },
    });
    expect(detached.statusCode).toBe(202);
    expect(db.getProject(project.id)?.publish_mode).toBe("private");
    expect(db.getProjectPublication(project.id)).toMatchObject({
      state: "removal_pending",
      detach_after_removal: 1,
    });

    const second = (await createFixtureProject("force-detach")).json<{ id: string }>();
    await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${second.id}/static-publication`,
      headers: { cookie },
      payload: { targetId: target.id },
    });
    const forced = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${second.id}/static-publication?force=true`,
      headers: { cookie },
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json()).toMatchObject({ detached: true });
    expect(db.getProject(second.id)?.publish_mode).toBe("private");
    expect(db.getProjectPublication(second.id)).toBeUndefined();
  });

  it("exposes failed remote removal and queues a retry", async () => {
    const cookie = `sad_session=${sessionToken}`;
    const project = (await createFixtureProject("retry-removal")).json<{ id: string }>();
    const target = (await createVercelTarget()).json<{ id: string }>();
    await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/static-publication`,
      headers: { cookie },
      payload: { targetId: target.id },
    });
    const publishJob = db.claimPublicationJob()!;
    db.completePublicationJob(publishJob, {
      deploymentId: "dpl_private",
      deploymentUrl: "https://history.example.com",
      manifest: { files: [] },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/static-publication`,
      headers: { cookie },
    });
    const removalJob = db.claimPublicationJob()!;
    db.raw.prepare("UPDATE publication_jobs SET attempts=5 WHERE id=?").run(removalJob.id);
    db.failPublicationJob({ ...removalJob, attempts: 5 }, "Invalid token");

    const failed = await app.inject({
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
    });
    expect(failed.json()).toMatchObject({
      staticPublication: {
        state: "removal_failed",
        lastError: "Invalid token",
        latestJob: { operation: "remove", status: "failed" },
      },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/static-publication`,
      headers: { cookie },
    });
    expect(db.getProjectPublication(project.id)?.state).toBe("removal_pending");
    expect(db.listPublicationJobs(target.id, 1)[0]).toMatchObject({
      operation: "remove",
      status: "queued",
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

  it("filters capture status before pagination and validates every query bound", async () => {
    const project = (await createFixtureProject("capture-pagination")).json<{
      id: string;
      profiles: Array<{ id: string }>;
    }>();
    const profileId = project.profiles[0]!.id;
    for (let index = 0; index < 14; index++)
      await seedCapture(
        project.id,
        profileId,
        "succeeded",
        new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      );
    for (let index = 0; index < 3; index++)
      await seedCapture(
        project.id,
        profileId,
        "failed",
        new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString(),
      );
    const cookie = `sad_session=${sessionToken}`;
    const first = await app.inject({
      url: `/api/v1/projects/${project.id}/captures?profileId=${profileId}&status=succeeded&limit=12&offset=0`,
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toHaveLength(12);
    expect(first.headers["x-total-count"]).toBe("14");
    expect(first.headers["x-successful-count"]).toBe("14");
    expect(first.headers["x-failed-count"]).toBe("3");
    const older = await app.inject({
      url: `/api/v1/projects/${project.id}/captures?profileId=${profileId}&status=succeeded&limit=12&offset=12`,
      headers: { cookie },
    });
    expect(older.json()).toHaveLength(2);
    for (const query of ["limit=-1", "limit=0", "limit=501", "limit=nope", "offset=-1"])
      expect(
        (
          await app.inject({
            url: `/api/v1/projects/${project.id}/captures?${query}`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(400);
  });

  it("pages successful public captures per profile without failed attempts consuming the limit", async () => {
    const project = (await createFixtureProject("public-pagination")).json<{
      id: string;
      profiles: Array<{ id: string }>;
    }>();
    const profileId = project.profiles[0]!.id;
    for (let index = 0; index < 13; index++)
      await seedCapture(
        project.id,
        profileId,
        "succeeded",
        new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      );
    for (let index = 0; index < 4; index++)
      await seedCapture(
        project.id,
        profileId,
        "failed",
        new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString(),
      );
    await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie: `sad_session=${sessionToken}` },
      payload: { publishMode: "indexable" },
    });
    const first = await app.inject({
      url: `/api/public/p/public-pagination?profileId=${profileId}&page=1`,
    });
    expect(first.json()).toMatchObject({
      profileId,
      page: 1,
      pageSize: 12,
      pageCount: 2,
      successfulCount: 13,
      failedCount: 4,
    });
    expect(first.json<{ captures: unknown[] }>().captures).toHaveLength(12);
    const second = await app.inject({
      url: `/api/public/p/public-pagination?profileId=${profileId}&page=2`,
    });
    expect(second.json<{ captures: unknown[] }>().captures).toHaveLength(1);
  });

  it("includes the latest successful thumbnail in project summaries", async () => {
    const project = (await createFixtureProject("dashboard-thumbnail")).json<{
      id: string;
      profiles: Array<{ id: string }>;
    }>();
    const profileId = project.profiles[0]!.id;
    const successful = await seedCapture(
      project.id,
      profileId,
      "succeeded",
      "2026-01-01T00:00:00.000Z",
    );
    await seedCapture(project.id, profileId, "failed", "2026-01-02T00:00:00.000Z");

    const response = await app.inject({
      url: "/api/v1/projects",
      headers: { cookie: `sad_session=${sessionToken}` },
    });
    const summary = response
      .json<Array<{ id: string; latestCaptureAt: string; latestThumbnailUrl: string }>>()
      .find((candidate) => candidate.id === project.id);
    expect(summary).toMatchObject({
      latestCaptureAt: "2026-01-01T00:00:00.000Z",
      latestThumbnailUrl: `/api/v1/captures/${successful.id}/thumbnail`,
    });
  });

  it("compares only distinct successful captures from the same project and profile", async () => {
    const project = (await createFixtureProject("comparison-validation")).json<{
      id: string;
      profiles: Array<{ id: string }>;
    }>();
    const profileId = project.profiles[0]!.id;
    const earlier = await seedCapture(
      project.id,
      profileId,
      "succeeded",
      "2026-01-01T00:00:00.000Z",
      "#000000",
    );
    const later = await seedCapture(
      project.id,
      profileId,
      "succeeded",
      "2026-01-02T00:00:00.000Z",
      "#ffffff",
    );
    const failed = await seedCapture(project.id, profileId, "failed", "2026-01-03T00:00:00.000Z");
    const cookie = `sad_session=${sessionToken}`;
    const valid = await app.inject({
      method: "POST",
      url: "/api/v1/comparisons",
      headers: { cookie },
      payload: { firstId: later.id, secondId: earlier.id },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({
      first: { id: earlier.id },
      second: { id: later.id },
      changePercent: 100,
    });
    for (const pair of [
      { firstId: earlier.id, secondId: earlier.id },
      { firstId: earlier.id, secondId: failed.id },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/comparisons",
            headers: { cookie },
            payload: pair,
          })
        ).statusCode,
      ).toBe(400);
  });

  it("rate-limits unauthenticated public pixel comparisons", async () => {
    const project = (await createFixtureProject("public-comparison-rate")).json<{
      id: string;
      profiles: Array<{ id: string }>;
    }>();
    const profileId = project.profiles[0]!.id;
    const earlier = await seedCapture(
      project.id,
      profileId,
      "succeeded",
      "2026-01-01T00:00:00.000Z",
    );
    const later = await seedCapture(
      project.id,
      profileId,
      "succeeded",
      "2026-01-02T00:00:00.000Z",
      "#ffffff",
    );
    await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie: `sad_session=${sessionToken}` },
      payload: { publishMode: "indexable" },
    });
    for (let request = 0; request < 6; request++)
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/public/p/public-comparison-rate/comparisons",
            payload: { firstId: earlier.id, secondId: later.id },
          })
        ).statusCode,
      ).toBe(200);
    const limited = await app.inject({
      method: "POST",
      url: "/api/public/p/public-comparison-rate/comparisons",
      payload: { firstId: earlier.id, secondId: later.id },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("manages the complete webhook lifecycle and retains test delivery status", async () => {
    const project = (await createFixtureProject("webhook-lifecycle")).json<{ id: string }>();
    const cookie = `sad_session=${sessionToken}`;
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/webhooks`,
      headers: { cookie },
      payload: {
        url: "https://localhost/sad",
        threshold: 1,
        events: ["capture.changed"],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const webhook = created.json<{ id: string; secret: string }>();
    const paused = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/webhooks/${webhook.id}`,
      headers: { cookie },
      payload: { enabled: false, threshold: 2 },
    });
    expect(paused.json()).toMatchObject({ enabled: false, threshold: 2 });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/projects/${project.id}/webhooks/${webhook.id}/test`,
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/webhooks/${webhook.id}`,
      headers: { cookie },
      payload: { enabled: true },
    });
    const rotated = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/webhooks/${webhook.id}/rotate-secret`,
      headers: { cookie },
      payload: {},
    });
    expect(rotated.json<{ secret: string }>().secret).not.toBe(webhook.secret);
    const test = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/webhooks/${webhook.id}/test`,
      headers: { cookie },
      payload: {},
    });
    expect(test.statusCode).toBe(202);
    const deliveries = await app.inject({
      url: `/api/v1/projects/${project.id}/webhooks/${webhook.id}/deliveries`,
      headers: { cookie },
    });
    expect(deliveries.json()).toMatchObject([
      {
        id: test.json<{ deliveryId: string }>().deliveryId,
        event: "webhook.test",
        status: "queued",
      },
    ]);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/projects/${project.id}/webhooks/${webhook.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(db.listWebhookDeliveries(webhook.id)).toEqual([]);
  });

  it("publishes request bodies and security schemes for every supported write operation", async () => {
    const response = await app.inject({ url: "/docs/api/json" });
    expect(response.statusCode, response.body).toBe(200);
    const document = response.json<{
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: unknown;
            responses: Record<string, { headers?: Record<string, unknown> }>;
          }
        >
      >;
      components: { securitySchemes: Record<string, unknown> };
    }>();
    expect(document.components.securitySchemes).toHaveProperty("sessionCookie");
    expect(document.components.securitySchemes).toHaveProperty("bearerToken");
    const writes = Object.values(document.paths).flatMap((path) =>
      ["post", "put", "patch"].flatMap((method) => (path[method] ? [path[method]] : [])),
    );
    expect(writes.length).toBeGreaterThan(20);
    expect(writes.every((operation) => operation.requestBody)).toBe(true);
    expect(Object.keys(document.paths).some((path) => path.startsWith("/internal/"))).toBe(false);
    expect(document.paths["/api/v1/auth/login"]!.post!.responses).toHaveProperty("200");
    expect(document.paths["/api/v1/auth/recover"]!.post!.responses).toHaveProperty("204");
    expect(
      document.paths["/api/v1/publication-targets/{id}/credentials"]!.put!.responses,
    ).toHaveProperty("204");
    expect(
      document.paths["/api/v1/projects/{id}/webhooks/{webhookId}/rotate-secret"]!.post!.responses,
    ).toHaveProperty("200");
    expect(
      document.paths["/api/v1/projects/{id}/profiles/{profileId}/exports"]!.get!.responses,
    ).toHaveProperty("200");
    expect(
      document.paths["/api/v1/projects/{id}/profiles/{profileId}/exports/{format}"]!.get!.responses,
    ).toHaveProperty("200");
    expect(document.paths["/api/v1/projects/{id}/captures"]!.get!.responses["200"]!.headers)
      .toMatchInlineSnapshot(`
        {
          "X-Failed-Count": {
            "description": "All failed captures in the selected project/profile",
            "schema": {
              "minimum": 0,
              "type": "integer",
            },
          },
          "X-Successful-Count": {
            "description": "All successful captures in the selected project/profile",
            "schema": {
              "minimum": 0,
              "type": "integer",
            },
          },
          "X-Total-Count": {
            "description": "Captures matching the requested status filter",
            "schema": {
              "minimum": 0,
              "type": "integer",
            },
          },
        }
      `);
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

  it("reports export progress and serves completed animations as downloads", async () => {
    const project = (await createFixtureProject("export-progress")).json<{
      id: string;
      profiles: Array<{ id: string }>;
    }>();
    const profileId = project.profiles[0]!.id;
    const cookie = `sad_session=${sessionToken}`;
    await seedCapture(project.id, profileId, "succeeded", "2026-01-01T00:00:00.000Z");
    await seedCapture(project.id, profileId, "succeeded", "2026-01-02T00:00:00.000Z");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}/publication`,
      headers: { cookie },
      payload: { publishMode: "indexable" },
    });

    const statusUrl = `/api/v1/projects/${project.id}/profiles/${profileId}/exports`;
    expect((await app.inject({ url: statusUrl, headers: { cookie } })).json()).toMatchObject([
      { format: "gif", status: "unavailable", available: false, downloadUrl: null },
      { format: "webm", status: "unavailable", available: false, downloadUrl: null },
    ]);

    const queued = await app.inject({
      method: "POST",
      url: statusUrl,
      headers: { cookie },
      payload: { format: "gif" },
    });
    expect(queued.statusCode, queued.body).toBe(202);
    expect(
      (await app.inject({ url: statusUrl, headers: { cookie } })).json<unknown[]>()[0],
    ).toMatchObject({
      format: "gif",
      status: "queued",
      available: false,
      requestedFrameCount: 2,
    });
    const publicQueued = await app.inject({ url: "/api/public/p/export-progress" });
    expect(publicQueued.json<{ exports: unknown[] }>().exports[0]).toMatchObject({
      format: "gif",
      status: "queued",
      available: false,
      error: null,
    });

    const gifJob = db.claimJob()!;
    expect(gifJob.id).toBe(queued.json<{ jobId: string }>().jobId);
    expect(
      (await app.inject({ url: statusUrl, headers: { cookie } })).json<unknown[]>()[0],
    ).toMatchObject({ format: "gif", status: "processing", requestedFrameCount: 2 });
    const gif = Buffer.from("generated-gif");
    await blobs.put("exports/progress.gif", gif);
    db.saveExport(gifJob, "exports/progress.gif", 2);
    const ready = await app.inject({ url: statusUrl, headers: { cookie } });
    expect(ready.json<unknown[]>()[0]).toMatchObject({
      format: "gif",
      status: "succeeded",
      available: true,
      frameCount: 2,
      downloadUrl: `/api/v1/projects/${project.id}/profiles/${profileId}/exports/gif`,
    });

    for (const url of [
      `/api/v1/projects/${project.id}/profiles/${profileId}/exports/gif`,
      `/p/export-progress/${profileId}/latest.gif`,
    ]) {
      const response = await app.inject({
        url,
        ...(url.startsWith("/api/") ? { headers: { cookie } } : {}),
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers["content-disposition"]).toBe(
        'attachment; filename="export-progress-latest.gif"',
      );
      expect(response.rawPayload).toEqual(gif);
    }

    const failed = await app.inject({
      method: "POST",
      url: statusUrl,
      headers: { cookie },
      payload: { format: "webm" },
    });
    db.raw
      .prepare("UPDATE jobs SET max_attempts=1 WHERE id=?")
      .run(failed.json<{ jobId: string }>().jobId);
    const webmJob = db.claimJob()!;
    expect(db.retryJob(webmJob, "ffmpeg diagnostic failure")).toBe(false);
    expect((await app.inject({ url: statusUrl, headers: { cookie } })).json()).toMatchObject([
      { format: "gif", status: "succeeded", available: true },
      {
        format: "webm",
        status: "failed",
        available: false,
        error: "ffmpeg diagnostic failure",
      },
    ]);
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
    expect(confirmedSchedule.json()).toMatchObject({
      scheduleEnabled: true,
      nextRunAt: expect.any(String),
    });

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

  it("keeps remote publication destinations within their secure boundaries", async () => {
    const cookie = `sad_session=${sessionToken}`;
    const target = (await createVercelTarget()).json<{ id: string }>();
    const downgraded = await app.inject({
      method: "PATCH",
      url: `/api/v1/publication-targets/${target.id}`,
      headers: { cookie },
      payload: { baseUrl: "http://history.example.com" },
    });
    expect(downgraded.statusCode).toBe(400);
    expect(downgraded.json<{ error: string }>().error).toContain("HTTPS");

    const unsafeRoot = await app.inject({
      method: "POST",
      url: "/api/v1/publication-targets",
      headers: { cookie },
      payload: {
        name: "Unsafe SFTP",
        baseUrl: "https://history.example.com",
        scheduleMode: "manual",
        scheduleExpression: null,
        scheduleTimezone: "UTC",
        branding: {
          title: "History",
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
          adapter: "sftp",
          config: {
            host: "sftp.example.com",
            port: 22,
            root: "/",
            username: "publisher",
            hostKeySha256: `SHA256:${"a".repeat(43)}`,
          },
          credentials: { kind: "password", password: "secret" },
        },
      },
    });
    expect(unsafeRoot.statusCode).toBe(400);
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
