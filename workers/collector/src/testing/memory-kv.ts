export class MemoryKv {
  private rows = new Map<string, { value: string; expiresAt: number | null }>();
  puts: { key: string; value: string; expirationTtl?: number }[] = [];
  deletes: string[] = [];
  now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(key: string, type?: "text" | { type: "text" }): Promise<string | null>;
  get(key: string, type: "json" | { type: "json" }): Promise<unknown>;
  async get(key: string, type?: "text" | "json" | { type: "text" | "json" }): Promise<unknown> {
    const row = this.rows.get(key);
    if (!row) return null;
    if (row.expiresAt != null && row.expiresAt <= this.now()) {
      this.rows.delete(key);
      return null;
    }
    const kind = typeof type === "object" ? type.type : type;
    return kind === "json" ? JSON.parse(row.value) : row.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.puts.push({ key, value, ...(options?.expirationTtl ? { expirationTtl: options.expirationTtl } : {}) });
    this.rows.set(key, { value, expiresAt: options?.expirationTtl ? this.now() + options.expirationTtl * 1000 : null });
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.rows.delete(key);
  }

  raw(key: string): string | undefined {
    return this.rows.get(key)?.value;
  }

  asKv(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}
