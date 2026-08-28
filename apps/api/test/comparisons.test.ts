import { describe, expect, it } from "vitest";
import { ComparisonCapacityError, ComparisonService } from "../src/comparisons.js";

const result = (value: number) => ({
  changePercent: value,
  diff: Buffer.from(String(value)),
  width: 1,
  height: 1,
});

describe("comparison service", () => {
  it("caches immutable results by key", async () => {
    let calls = 0;
    const service = new ComparisonService(async () => result(++calls));
    expect(
      (await service.run("a:b", async () => [Buffer.alloc(0), Buffer.alloc(0)])).changePercent,
    ).toBe(1);
    expect(
      (await service.run("a:b", async () => [Buffer.alloc(0), Buffer.alloc(0)])).changePercent,
    ).toBe(1);
    expect(calls).toBe(1);
  });

  it("allows one active and four queued comparisons before rejecting capacity", async () => {
    const releases: Array<() => void> = [];
    const service = new ComparisonService(
      () => new Promise((resolve) => releases.push(() => resolve(result(0)))),
    );
    const running = service.run("0", async () => [Buffer.alloc(0), Buffer.alloc(0)]);
    const queued = Array.from({ length: 4 }, (_, index) =>
      service.run(String(index + 1), async () => [Buffer.alloc(0), Buffer.alloc(0)]),
    );
    await expect(
      service.run("overflow", async () => [Buffer.alloc(0), Buffer.alloc(0)]),
    ).rejects.toBeInstanceOf(ComparisonCapacityError);
    for (let index = 0; index < 5; index++) {
      while (!releases[index]) await Promise.resolve();
      releases[index]!();
      await Promise.resolve();
    }
    await Promise.all([running, ...queued]);
  });
});
