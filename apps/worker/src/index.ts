import { PRODUCT_VERSION } from "@sad/contracts";
import { WorkerApi } from "./api.js";
import { runCapture } from "./capture.js";
import { loadWorkerConfig } from "./config.js";
import { runExport } from "./export.js";
import { withLeaseRenewal } from "./lease.js";

const config = loadWorkerConfig();
const api = new WorkerApi(config);
let stopping = false;
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function loop(slot: number): Promise<void> {
  while (!stopping) {
    try {
      const job = await api.claim();
      if (!job) {
        await sleep(config.pollMs);
        continue;
      }
      console.log(
        JSON.stringify({
          level: "info",
          message: "job claimed",
          slot,
          jobId: job.id,
          type: job.type,
          attempt: job.attempt,
        }),
      );
      await withLeaseRenewal(job, api, async () => {
        if (job.type === "capture") await runCapture(job, api);
        else {
          try {
            await runExport(job, api, config);
          } catch (error) {
            await api.reportError(job, error instanceof Error ? error.message : "Export failed");
          }
        }
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "worker loop failed",
          slot,
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
      await sleep(config.pollMs);
    }
  }
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log(
  JSON.stringify({
    level: "info",
    message: "Screenshot-a-Day worker started",
    version: PRODUCT_VERSION,
    concurrency: config.concurrency,
  }),
);
await Promise.all(Array.from({ length: config.concurrency }, (_, index) => loop(index + 1)));
