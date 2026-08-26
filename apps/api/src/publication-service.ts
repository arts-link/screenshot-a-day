import type { FastifyBaseLogger } from "fastify";
import { decryptJson, nextSchedule } from "@sad/core";
import type { PublicationScheduleMode } from "@sad/contracts";
import type { AppConfig } from "./config.js";
import type { AppDatabase, PublicationJobRow, PublicationTargetRow } from "./database.js";
import { publicationAdapterFor, type PublicationAdapter } from "./publication-adapters.js";
import type { ManagedFile, PublicationRenderer } from "./publication-renderer.js";

export function publicationCron(
  mode: PublicationScheduleMode,
  custom: string | null,
): string | null {
  if (mode === "hourly") return "0 * * * *";
  if (mode === "daily") return "0 0 * * *";
  if (mode === "weekly") return "0 0 * * 0";
  if (mode === "custom") return custom;
  return null;
}

export function nextPublicationRun(
  mode: PublicationScheduleMode,
  expression: string | null,
  timezone: string,
): string | null {
  const cron = publicationCron(mode, expression);
  return cron ? nextSchedule(cron, timezone).toISOString() : null;
}

interface PublicationServiceOptions {
  db: AppDatabase;
  config: AppConfig;
  renderer: PublicationRenderer;
  log: FastifyBaseLogger;
  adapterFor?: (target: PublicationTargetRow) => PublicationAdapter;
  intervalMs?: number;
}

export class PublicationService {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly options: PublicationServiceOptions) {}

  start(): () => void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? 5_000);
    this.timer.unref();
    return () => {
      if (this.timer) clearInterval(this.timer);
    };
  }

  rendererStatus(): Promise<{ available: boolean; error: string | null }> {
    return this.options.renderer.verify();
  }

  publishNow(targetId: string): string {
    return this.options.db.enqueuePublication(targetId, "publish", true);
  }

  async verifyTarget(target: PublicationTargetRow): Promise<void> {
    const credentials = decryptJson<unknown>(
      target.credentials_encrypted,
      this.options.config.encryptionKey,
    );
    const adapter = this.adapter(target);
    try {
      await adapter.verify(target, credentials);
      this.options.db.recordPublicationVerification(target.id, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection verification failed";
      this.options.db.recordPublicationVerification(target.id, message);
      throw error;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const target of this.options.db.listDuePublicationTargets()) {
        if (target.dirty_revision > target.published_revision)
          this.options.db.enqueuePublication(target.id, "publish", true);
        this.options.db.setPublicationNextRun(
          target.id,
          nextPublicationRun(
            target.schedule_mode,
            target.schedule_expression,
            target.schedule_timezone,
          ),
        );
      }
      const job = this.options.db.claimPublicationJob();
      if (job) await this.execute(job);
    } catch (error) {
      this.options.log.error(
        { error: error instanceof Error ? error.message : "unknown" },
        "publication tick failed",
      );
    } finally {
      this.running = false;
    }
  }

  private adapter(target: PublicationTargetRow): PublicationAdapter {
    return (
      this.options.adapterFor?.(target) ??
      publicationAdapterFor(target, this.options.config.privateTargetAllowlist)
    );
  }

  private async execute(job: PublicationJobRow): Promise<void> {
    const target = this.options.db.getPublicationTarget(job.target_id);
    if (!target || !job.lease_token) return;
    const lease = setInterval(
      () => this.options.db.renewPublicationLease(job.id, job.lease_token!),
      60_000,
    );
    lease.unref();
    let site;
    try {
      const renderer = await this.options.renderer.verify();
      if (!renderer.available)
        throw new Error(renderer.error ?? "Static publication is unavailable");
      site = await this.options.renderer.render(target);
      if (!this.options.db.setPublicationJobDeploying(job.id, job.lease_token))
        throw new Error("Publication job lease expired before deployment");
      const credentials = decryptJson<unknown>(
        target.credentials_encrypted,
        this.options.config.encryptionKey,
      );
      const previous = this.options.db.latestPublicationManifest(target.id);
      const previousFiles = previous
        ? ((JSON.parse(previous.manifest_json) as { files?: ManagedFile[] }).files ?? [])
        : [];
      const controller = new AbortController();
      const deployTimeout = setTimeout(
        () => controller.abort(new Error("Publication deployment timed out")),
        this.options.config.publicationDeployTimeoutMs,
      );
      deployTimeout.unref();
      let deployment;
      try {
        deployment = await this.adapter(target).deploy(
          target,
          credentials,
          site,
          previousFiles,
          controller.signal,
        );
      } finally {
        clearTimeout(deployTimeout);
      }
      this.options.db.completePublicationJob(job, {
        deploymentId: deployment.deploymentId,
        deploymentUrl: deployment.deploymentUrl,
        manifest: { renderer: this.options.renderer.id, files: site.files },
      });
      this.options.log.info(
        {
          targetId: target.id,
          revision: job.desired_revision,
          deploymentId: deployment.deploymentId,
        },
        "static publication deployed",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publication failed";
      const retrying = this.options.db.failPublicationJob(job, message);
      this.options.log.warn(
        { targetId: target.id, retrying, error: message },
        "static publication failed",
      );
    } finally {
      clearInterval(lease);
      await site?.cleanup();
    }
  }
}
