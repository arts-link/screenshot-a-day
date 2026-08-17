import { workerJobSchema, type WorkerJob } from "@sad/contracts";
import type { WorkerConfig } from "./config.js";

export class WorkerApi {
  constructor(private readonly config: WorkerConfig) {}
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.config.token}`, ...extra };
  }

  async claim(): Promise<WorkerJob | null> {
    const response = await fetch(`${this.config.apiUrl}/internal/v1/jobs/claim`, {
      method: "POST",
      headers: this.headers(),
    });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`Job claim failed with HTTP ${response.status}`);
    return workerJobSchema.parse(await response.json());
  }

  async renew(job: WorkerJob): Promise<void> {
    const response = await fetch(`${this.config.apiUrl}/internal/v1/jobs/${job.id}/renew`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ leaseToken: job.leaseToken }),
    });
    if (!response.ok) throw new Error(`Lease renewal failed with HTTP ${response.status}`);
  }

  async upload(job: WorkerJob, bytes: Buffer, metadata: unknown): Promise<void> {
    const response = await fetch(`${this.config.apiUrl}/internal/v1/jobs/${job.id}/artifact`, {
      method: "POST",
      headers: this.headers({
        "content-type": "application/octet-stream",
        "x-sad-lease": job.leaseToken,
        "x-sad-metadata": Buffer.from(JSON.stringify(metadata)).toString("base64url"),
      }),
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new Error(`Artifact upload failed with HTTP ${response.status}`);
  }

  async fail(
    job: Extract<WorkerJob, { type: "capture" }>,
    input: {
      capturedAt: string;
      error: string;
      finalUrl: string | null;
      durationMs: number;
      screenshot?: Buffer;
      width?: number;
      height?: number;
    },
  ): Promise<void> {
    const response = await fetch(`${this.config.apiUrl}/internal/v1/jobs/${job.id}/failure`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        leaseToken: job.leaseToken,
        capturedAt: input.capturedAt,
        error: input.error,
        finalUrl: input.finalUrl,
        durationMs: input.durationMs,
        screenshotBase64:
          input.screenshot && input.screenshot.length <= 18_000_000
            ? input.screenshot.toString("base64")
            : null,
        width: input.width ?? null,
        height: input.height ?? null,
      }),
    });
    if (!response.ok) throw new Error(`Failure report failed with HTTP ${response.status}`);
  }

  async download(url: string): Promise<Buffer> {
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`Frame download failed with HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async reportError(job: WorkerJob, error: string): Promise<void> {
    const response = await fetch(`${this.config.apiUrl}/internal/v1/jobs/${job.id}/error`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ leaseToken: job.leaseToken, error: error.slice(0, 4000) }),
    });
    if (!response.ok) throw new Error(`Job error report failed with HTTP ${response.status}`);
  }
}
