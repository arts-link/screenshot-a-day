export interface CaptureRun {
  id: string;
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  job_count: number;
  succeeded_count: number;
  failed_count: number;
  capture_job_count: number;
}

interface CaptureRandomSource {
  randomUUID?: () => string;
  getRandomValues(array: Uint8Array): Uint8Array;
}

interface CaptureLock {
  current: boolean;
}

export function captureIdempotencyKey(source: CaptureRandomSource = crypto): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  return Array.from(source.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function triggerCaptureRequest(
  lock: CaptureLock,
  busy: boolean,
  mutate: (idempotencyKey: string) => void,
  createKey: () => string = captureIdempotencyKey,
): boolean {
  if (lock.current || busy) return false;
  lock.current = true;
  try {
    mutate(createKey());
    return true;
  } catch (error) {
    lock.current = false;
    throw error;
  }
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
