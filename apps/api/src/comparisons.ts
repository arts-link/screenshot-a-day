import { compareImages } from "./images.js";

export interface ComparisonImageResult {
  changePercent: number;
  diff: Buffer;
  width: number;
  height: number;
}

export class ComparisonCapacityError extends Error {
  constructor() {
    super("Comparison capacity is full; retry shortly");
    this.name = "ComparisonCapacityError";
  }
}

interface CacheEntry {
  result: ComparisonImageResult;
  expiresAt: number;
  bytes: number;
}

export class ComparisonService {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;

  constructor(
    private readonly compare: (
      first: Buffer,
      second: Buffer,
    ) => Promise<ComparisonImageResult> = compareImages,
    private readonly options = {
      maxConcurrent: 1,
      maxQueued: 4,
      cacheBytes: 64 * 1024 * 1024,
      cacheTtlMs: 10 * 60_000,
    },
  ) {}

  async run(key: string, load: () => Promise<[Buffer, Buffer]>): Promise<ComparisonImageResult> {
    const cached = this.getCached(key);
    if (cached) return cached;
    await this.acquire();
    try {
      const secondCached = this.getCached(key);
      if (secondCached) return secondCached;
      const [first, second] = await load();
      const result = await this.compare(first, second);
      this.putCached(key, result);
      return result;
    } finally {
      this.release();
    }
  }

  private getCached(key: string): ComparisonImageResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      this.cacheBytes -= entry.bytes;
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  private putCached(key: string, result: ComparisonImageResult): void {
    const bytes = result.diff.byteLength;
    if (bytes > this.options.cacheBytes) return;
    const existing = this.cache.get(key);
    if (existing) this.cacheBytes -= existing.bytes;
    this.cache.delete(key);
    this.cache.set(key, {
      result,
      bytes,
      expiresAt: Date.now() + this.options.cacheTtlMs,
    });
    this.cacheBytes += bytes;
    while (this.cacheBytes > this.options.cacheBytes) {
      const oldest = this.cache.entries().next().value as [string, CacheEntry] | undefined;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.cacheBytes -= oldest[1].bytes;
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.options.maxConcurrent) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= this.options.maxQueued) throw new ComparisonCapacityError();
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}
