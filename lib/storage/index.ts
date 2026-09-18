import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

/**
 * Storage abstraction so the local-disk implementation used in dev can be
 * swapped for an S3-compatible one in production without touching callers.
 */
export interface StorageAdapter {
  save(buffer: Buffer, originalName: string): Promise<string>; // returns storageKey
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

class LocalDiskStorage implements StorageAdapter {
  async save(buffer: Buffer, originalName: string): Promise<string> {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const storageKey = `${randomUUID()}-${sanitizeFilename(originalName)}`;
    await writeFile(path.join(UPLOAD_DIR, storageKey), buffer);
    return storageKey;
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolve(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await unlink(this.resolve(storageKey)).catch(() => undefined);
  }

  private resolve(storageKey: string): string {
    const resolved = path.join(UPLOAD_DIR, storageKey);
    if (!resolved.startsWith(UPLOAD_DIR)) {
      throw new Error("Invalid storage key");
    }
    return resolved;
  }
}

export const storage: StorageAdapter = new LocalDiskStorage();
