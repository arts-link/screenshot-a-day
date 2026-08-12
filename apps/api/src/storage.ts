import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export interface BlobStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  size(key: string): Promise<number>;
  usage?(): Promise<{ bytes: number; files: number }>;
}

function safeKey(key: string): string {
  const normalized = normalize(key).replace(/^[/\\]+/, "");
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../")) {
    throw new Error("Invalid blob key");
  }
  return normalized;
}

export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = join(this.root, safeKey(key));
    const temporary = `${path}.${process.pid}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, path);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(join(this.root, safeKey(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.root, safeKey(key)), { force: true });
  }

  async size(key: string): Promise<number> {
    return (await stat(join(this.root, safeKey(key)))).size;
  }

  async usage(): Promise<{ bytes: number; files: number }> {
    let bytes = 0;
    let files = 0;
    const visit = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else {
          bytes += (await stat(path)).size;
          files++;
        }
      }
    };
    await visit(this.root);
    return { bytes, files };
  }
}
