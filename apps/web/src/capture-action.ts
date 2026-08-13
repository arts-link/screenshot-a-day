export interface CaptureRun {
  id: string;
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  job_count: number;
  succeeded_count: number;
  failed_count: number;
  capture_job_count: number;
}

export function activeCaptureRun(runs: CaptureRun[] | undefined): CaptureRun | undefined {
  return runs?.find(
    (run) => run.capture_job_count > 0 && (run.status === "queued" || run.status === "running"),
  );
}

export function captureActionLabel(submitting: boolean, run: CaptureRun | undefined): string {
  if (submitting || (run && run.status === "queued")) return "Capture queued…";
  if (run?.status === "running") {
    const complete = run.succeeded_count + run.failed_count;
    return `Capturing ${complete}/${run.job_count}…`;
  }
  if (run?.status === "succeeded") return "Capture complete";
  if (run?.status === "partial") return "Capture partially complete";
  if (run?.status === "failed") return "Capture failed";
  return "Capture now";
}

export function captureActionDetail(
  submitting: boolean,
  run: CaptureRun | undefined,
): string | undefined {
  if (submitting || run?.status === "queued") return "Waiting for an available worker.";
  if (run?.status === "running")
    return "Keep this page open or come back later; progress is saved.";
  if (run?.status === "succeeded")
    return `${run.succeeded_count} screenshot${run.succeeded_count === 1 ? "" : "s"} added.`;
  if (run?.status === "partial")
    return `${run.succeeded_count} succeeded; ${run.failed_count} failed.`;
  if (run?.status === "failed") return "The worker could not complete this batch.";
  return undefined;
}
