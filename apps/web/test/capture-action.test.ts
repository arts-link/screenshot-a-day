import { describe, expect, it } from "vitest";
import {
  activeCaptureRun,
  captureIdempotencyKey,
  captureActionDetail,
  captureActionLabel,
  triggerCaptureRequest,
  type CaptureRun,
} from "../src/capture-action";

function run(input: Partial<CaptureRun> = {}): CaptureRun {
  return {
    id: "run-1",
    status: "queued",
    job_count: 3,
    capture_job_count: 3,
    succeeded_count: 0,
    failed_count: 0,
    ...input,
  };
}

describe("capture action feedback", () => {
  it("keeps the action busy for queued and running capture batches", () => {
    expect(activeCaptureRun([run()])?.id).toBe("run-1");
    expect(captureActionLabel(false, run())).toBe("Capture queued…");
    expect(captureActionLabel(false, run({ status: "running", succeeded_count: 1 }))).toBe(
      "Capturing 1/3…",
    );
  });

  it("ignores active export batches", () => {
    expect(activeCaptureRun([run({ capture_job_count: 0 })])).toBeUndefined();
  });

  it("acknowledges completion with the number of screenshots added", () => {
    const completed = run({ status: "succeeded", succeeded_count: 3 });
    expect(captureActionLabel(false, completed)).toBe("Capture complete");
    expect(captureActionDetail(false, completed)).toBe("3 screenshots added.");
  });
});

describe("capture request safety", () => {
  it("uses randomUUID when the browser provides it", () => {
    expect(
      captureIdempotencyKey({
        randomUUID: () => "browser-uuid",
        getRandomValues: () => {
          throw new Error("fallback should not run");
        },
      }),
    ).toBe("browser-uuid");
  });

  it("creates a random idempotency key when randomUUID is unavailable", () => {
    expect(
      captureIdempotencyKey({
        getRandomValues: (bytes) => {
          bytes.fill(0xab);
          return bytes;
        },
      }),
    ).toBe("ab".repeat(16));
  });

  it("releases the capture lock after a synchronous failure", () => {
    const lock = { current: false };
    expect(() =>
      triggerCaptureRequest(
        lock,
        false,
        () => undefined,
        () => {
          throw new Error("random source unavailable");
        },
      ),
    ).toThrow("random source unavailable");
    expect(lock.current).toBe(false);
  });
});
