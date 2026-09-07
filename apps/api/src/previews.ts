import type { AppDatabase, CaptureRow } from "./database.js";
import { thumbnail } from "./images.js";
import type { BlobStore } from "./storage.js";

export const PREVIEW_CACHE_VERSION = "2";
const CURRENT_PREVIEW_PREFIXES = ["previews/v2/", "failure-previews/v2/"];

export function versionedPreviewUrl(path: string): string {
  return `${path}?v=${PREVIEW_CACHE_VERSION}`;
}

function isCurrentPreview(key: string): boolean {
  return CURRENT_PREVIEW_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function previewKey(capture: CaptureRow): string {
  const prefix = capture.status === "failed" ? "failure-previews" : "previews";
  return `${prefix}/v2/${capture.project_id}/${capture.profile_id}/${capture.id}.webp`;
}

export class PreviewService {
  private readonly repairs = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly db: AppDatabase,
    private readonly blobs: BlobStore,
  ) {}

  async get(capture: CaptureRow, markPublication = true): Promise<Buffer> {
    if (!capture.thumbnail_key) throw new Error("Preview artifact is unavailable");
    if (isCurrentPreview(capture.thumbnail_key)) return this.blobs.get(capture.thumbnail_key);

    const existing = this.repairs.get(capture.id);
    if (existing) return existing;
    const repair = this.repair(capture, markPublication).finally(() => {
      this.repairs.delete(capture.id);
    });
    this.repairs.set(capture.id, repair);
    return repair;
  }

  async repairLegacy(): Promise<{ repaired: number; failed: number }> {
    const projects = new Set<string>();
    let repaired = 0;
    let failed = 0;
    for (const capture of this.db.listStoredPreviewCaptures()) {
      if (!capture.thumbnail_key || isCurrentPreview(capture.thumbnail_key)) continue;
      try {
        await this.get(capture, false);
        projects.add(capture.project_id);
        repaired++;
      } catch {
        failed++;
      }
    }
    for (const projectId of projects) this.db.markProjectPublicationDirty(projectId);
    return { repaired, failed };
  }

  private async repair(capture: CaptureRow, markPublication: boolean): Promise<Buffer> {
    if (!capture.image_key || !capture.thumbnail_key)
      throw new Error("Preview source artifact is unavailable");
    const bytes = await thumbnail(await this.blobs.get(capture.image_key));
    const key = previewKey(capture);
    await this.blobs.put(key, bytes);
    const replaced = this.db.replaceCapturePreview(capture.id, capture.thumbnail_key, key);
    if (replaced && markPublication) this.db.markProjectPublicationDirty(capture.project_id);
    return bytes;
  }
}
