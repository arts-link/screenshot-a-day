import type { WorkerJob } from "@sad/contracts";
import type { WorkerApi } from "./api.js";

export const LEASE_RENEWAL_INTERVAL_MS = 30_000;

export async function withLeaseRenewal(
  job: WorkerJob,
  api: Pick<WorkerApi, "renew">,
  task: () => Promise<void>,
  intervalMs = LEASE_RENEWAL_INTERVAL_MS,
): Promise<void> {
  let renewal: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewal) return;
    renewal = api
      .renew(job)
      .catch((error) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "job lease renewal failed",
            jobId: job.id,
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
      })
      .finally(() => {
        renewal = undefined;
      });
  }, intervalMs);
  timer.unref();

  try {
    await task();
  } finally {
    clearInterval(timer);
  }
}
