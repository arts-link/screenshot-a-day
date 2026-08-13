import { describe, expect, it } from "vitest";
import {
  activeCaptureRun,
  captureActionDetail,
  captureActionLabel,
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
