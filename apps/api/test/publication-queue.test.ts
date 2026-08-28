import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import { AppDatabase } from "../src/database.js";

describe("publication queue", () => {
  const databases: Array<{ db: AppDatabase; directory: string }> = [];

  afterEach(async () => {
    for (const fixture of databases.splice(0)) {
      fixture.db.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  async function fixture(scheduleMode: "manual" | "on_change" | "hourly" = "on_change") {
    const directory = await mkdtemp(join(tmpdir(), "sad-publication-queue-"));
    const db = new AppDatabase(join(directory, "sad.sqlite"));
    databases.push({ db, directory });
    const target = db.createPublicationTarget(
      {
        name: "Fixture",
        baseUrl: "https://history.example.com",
        scheduleMode,
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
          credentials: { token: "unused" },
        },
      },
      "encrypted",
      null,
    );
    return { db, target };
  }

  it("forwards an existing migration-1 database through migration 3", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sad-publication-migration-"));
    const path = join(directory, "sad.sqlite");
    const legacy = new DatabaseConstructor(path);
    legacy.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1, '2026-01-01T00:00:00.000Z')",
    );
    legacy.close();
    const db = new AppDatabase(path);
    databases.push({ db, directory });
    expect(db.raw.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
    ]);
    expect(
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='publication_targets'")
        .get(),
    ).toEqual({ name: "publication_targets" });
    expect(
      db.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='captures_profile_status_history_idx'",
        )
        .get(),
    ).toEqual({ name: "captures_profile_status_history_idx" });
  });

  it("uses a sliding debounce and coalesces bursts into one desired revision", async () => {
    const { db, target } = await fixture();
    const firstAvailable = new Date(Date.now() + 60_000).toISOString();
    db.markPublicationTargetDirty(target.id);
    const first = db.listPublicationJobs(target.id)[0]!;
    expect(new Date(first.available_at).getTime()).toBeGreaterThanOrEqual(
      new Date(firstAvailable).getTime() - 1000,
    );
    db.markPublicationTargetDirty(target.id);
    const jobs = db.listPublicationJobs(target.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ desired_revision: 2, status: "queued" });
    expect(jobs[0]!.available_at >= first.available_at).toBe(true);
  });

  it("publishes manually, recovers expired leases, and creates one successor for changes during deployment", async () => {
    const { db, target } = await fixture("manual");
    db.markPublicationTargetDirty(target.id);
    expect(db.listPublicationJobs(target.id)).toHaveLength(0);
    db.enqueuePublication(target.id);
    const base = new Date();
    const claimed = db.claimPublicationJob(1, base)!;
    expect(claimed.status).toBe("building");
    const recovered = db.claimPublicationJob(60, new Date(base.getTime() + 2_000));
    expect(recovered?.id).toBe(claimed.id);
    expect(recovered?.attempts).toBe(2);
    db.markPublicationTargetDirty(target.id, true);
    db.markPublicationTargetDirty(target.id, true);
    expect(db.listPublicationJobs(target.id).filter((job) => job.status === "queued")).toHaveLength(
      1,
    );
  });

  it("retries transient failures five times with capped backoff", async () => {
    const { db, target } = await fixture("manual");
    db.enqueuePublication(target.id);
    let job = db.claimPublicationJob(60)!;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const retrying = db.failPublicationJob(job, `failure ${attempt}`);
      expect(retrying).toBe(attempt < 5);
      if (!retrying) break;
      db.raw
        .prepare("UPDATE publication_jobs SET available_at=? WHERE id=?")
        .run(new Date(0).toISOString(), job.id);
      job = db.claimPublicationJob(60)!;
    }
    expect(db.listPublicationJobs(target.id)[0]).toMatchObject({
      status: "failed",
      attempts: 5,
      error: "failure 5",
    });
  });

  it("advances due scheduled targets even when there is nothing to publish", async () => {
    const { db, target } = await fixture("hourly");
    db.setPublicationNextRun(target.id, new Date(0).toISOString());
    expect(db.listDuePublicationTargets()).toEqual([
      expect.objectContaining({ id: target.id, dirty_revision: 0, published_revision: 0 }),
    ]);
  });
});
