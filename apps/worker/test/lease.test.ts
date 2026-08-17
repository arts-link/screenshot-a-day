import type { WorkerJob } from "@sad/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withLeaseRenewal } from "../src/lease.js";

afterEach(() => vi.useRealTimers());

describe("job lease renewal", () => {
  it("renews while work is active and stops after it completes", async () => {
    vi.useFakeTimers();
    const renew = vi.fn(async () => undefined);
    let finish!: () => void;
    const task = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const job = { id: "long-job", leaseToken: "lease" } as WorkerJob;

    const running = withLeaseRenewal(job, { renew }, () => task, 1_000);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(renew).toHaveBeenCalledTimes(3);
    expect(renew).toHaveBeenCalledWith(job);

    finish();
    await running;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(renew).toHaveBeenCalledTimes(3);
  });
});
