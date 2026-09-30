import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface StateStore {
  get(key: string): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class FileStore implements StateStore {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    return join(this.dir, encodeURIComponent(key));
  }

  async get(key: string): Promise<string | null>;
  async get(key: string, type: "json"): Promise<unknown>;
  async get(key: string, type?: "json"): Promise<string | null | unknown> {
    try {
      const text = await readFile(this.path(key), "utf8");
      return type === "json" ? JSON.parse(text) as unknown : text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async put(key: string, value: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.path(key);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

export class MemoryStore implements StateStore {
  private readonly rows = new Map<string, string>();

  async get(key: string): Promise<string | null>;
  async get(key: string, type: "json"): Promise<unknown>;
  async get(key: string, type?: "json"): Promise<string | null | unknown> {
    const text = this.rows.get(key);
    if (text == null) return null;
    return type === "json" ? JSON.parse(text) as unknown : text;
  }

  async put(key: string, value: string): Promise<void> {
    this.rows.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }

  raw(key: string): string | undefined {
    return this.rows.get(key);
  }
}
