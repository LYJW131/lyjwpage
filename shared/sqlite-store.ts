import { parseCommands, type StorageCommand } from "@shared/storage-contract";

type SqlValue = string | number | null | ArrayBuffer;
type Row = Record<string, SqlValue>;
export interface SqlDatabase {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Row[]; rowsWritten: number };
}
export type StoredEntry = { key: string; kind: "string" | "hash" | "list"; value: string | Record<string, string> | string[]; expiresAt: number | null };

export class SqliteStore {
  private sql: SqlDatabase;
  private transaction: <T>(work: () => T) => T;
  private now: () => number;
  constructor(sql: SqlDatabase, transaction: <T>(work: () => T) => T, now: () => number = Date.now) {
    this.sql = sql; this.transaction = transaction; this.now = now;
    sql.exec(`CREATE TABLE IF NOT EXISTS entries (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('string','hash','list')),
      value TEXT, expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS entries_expiry ON entries(expires_at) WHERE expires_at IS NOT NULL;
    CREATE TABLE IF NOT EXISTS fields (key TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(key, field));
    CREATE TABLE IF NOT EXISTS samples (key TEXT NOT NULL, seq INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(key, seq));`);
  }

  execute(commands: StorageCommand[]): unknown[] {
    parseCommands(commands);
    return this.transaction(() => commands.map((command) => this.command(command)));
  }

  private entry(key: string): Row | undefined {
    const row = this.sql.exec("SELECT kind, value, expires_at FROM entries WHERE key = ?", key).toArray()[0];
    if (row && row.expires_at !== null && Number(row.expires_at) <= this.now()) { this.remove(key); return undefined; }
    return row;
  }
  private requireKind(key: string, kind: string): Row | undefined {
    const row = this.entry(key);
    if (row && row.kind !== kind) throw new Error("Storage type mismatch");
    return row;
  }
  private remove(key: string): number {
    this.sql.exec("DELETE FROM fields WHERE key = ?", key);
    this.sql.exec("DELETE FROM samples WHERE key = ?", key);
    return this.sql.exec("DELETE FROM entries WHERE key = ?", key).rowsWritten;
  }
  private count(key: string): number { return Number(this.sql.exec("SELECT COUNT(*) AS n FROM samples WHERE key = ?", key).toArray()[0]?.n ?? 0); }
  private range(length: number, start: number, stop: number): [number, number] {
    const from = start < 0 ? Math.max(length + start, 0) : start;
    const to = stop < 0 ? length + stop : Math.min(stop, length - 1);
    return [from, Math.max(0, to - from + 1)];
  }

  private command(command: StorageCommand): unknown {
    const { key } = command;
    switch (command.op) {
      case "get": return this.requireKind(key, "string")?.value ?? null;
      case "set": {
        const previous = this.entry(key);
        if (previous && command.options?.ifAbsent) return false;
        if (previous && previous.kind !== "string") this.remove(key);
        this.sql.exec("INSERT INTO entries(key, kind, value, expires_at) VALUES (?, 'string', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at", key, command.value, command.options?.ttlMs ? this.now() + command.options.ttlMs : null);
        return true;
      }
      case "remove": this.entry(key); return this.remove(key);
      case "expire": {
        if (!this.entry(key)) return 0;
        this.sql.exec("UPDATE entries SET expires_at = ? WHERE key = ?", this.now() + command.ttlMs, key);
        return 1;
      }
      case "patch": {
        this.requireKind(key, "hash");
        this.sql.exec("INSERT OR IGNORE INTO entries(key, kind) VALUES (?, 'hash')", key);
        for (const [field, value] of Object.entries(command.fields)) {
          this.sql.exec("INSERT INTO fields(key, field, value) VALUES (?, ?, ?) ON CONFLICT(key, field) DO UPDATE SET value = excluded.value", key, field, value);
        }
        return Object.keys(command.fields).length;
      }
      case "fields": {
        if (!this.requireKind(key, "hash")) return {};
        return Object.fromEntries(this.sql.exec("SELECT field, value FROM fields WHERE key = ?", key).toArray().map((row) => [String(row.field), String(row.value)]));
      }
      // 返回末尾序号而不是条数：列表只从头裁掉，序号连续，两者相等；数条数要扫整条列表。
      case "append": {
        this.requireKind(key, "list");
        this.sql.exec("INSERT OR IGNORE INTO entries(key, kind) VALUES (?, 'list')", key);
        let seq = Number(this.sql.exec("SELECT COALESCE(MAX(seq), 0) AS n FROM samples WHERE key = ?", key).toArray()[0]?.n ?? 0);
        for (const value of command.values) this.sql.exec("INSERT INTO samples(key, seq, value) VALUES (?, ?, ?)", key, ++seq, value);
        return seq;
      }
      case "listRange": {
        if (!this.requireKind(key, "list")) return [];
        if (command.start >= 0 && command.stop >= -1) {
          const limit = command.stop === -1 ? -1 : Math.max(0, command.stop - command.start + 1);
          return this.sql.exec(
            "SELECT value FROM samples WHERE key = ? ORDER BY seq LIMIT ? OFFSET ?",
            key,
            limit,
            command.start,
          ).toArray().map((row) => String(row.value));
        }
        if (command.start < 0 && command.stop < 0) {
          const limit = Math.max(0, command.stop - command.start + 1);
          const offset = -command.stop - 1;
          return this.sql.exec(
            "SELECT value FROM samples WHERE key = ? ORDER BY seq DESC LIMIT ? OFFSET ?",
            key,
            limit,
            offset,
          ).toArray().map((row) => String(row.value)).reverse();
        }
        const [offset, limit] = this.range(this.count(key), command.start, command.stop);
        return this.sql.exec("SELECT value FROM samples WHERE key = ? ORDER BY seq LIMIT ? OFFSET ?", key, limit, offset).toArray().map((row) => String(row.value));
      }
      // 从新往旧按主键分页，读到第一条 field <= since 的行（连它一起带上，跨边界的区间和保持量靠它）就停。
      case "listSince": {
        if (!this.requireKind(key, "list")) return [];
        const path = `$.${command.field}`;
        const rows: string[] = [];
        let before: number | null = null;
        let page = 256;
        while (rows.length < command.limit) {
          const chunk = before === null
            ? this.sql.exec("SELECT seq, value, CASE WHEN json_valid(value) THEN json_extract(value, ?) END AS at FROM samples WHERE key = ? ORDER BY seq DESC LIMIT ?", path, key, Math.min(page, command.limit - rows.length))
            : this.sql.exec("SELECT seq, value, CASE WHEN json_valid(value) THEN json_extract(value, ?) END AS at FROM samples WHERE key = ? AND seq < ? ORDER BY seq DESC LIMIT ?", path, key, before, Math.min(page, command.limit - rows.length));
          const batch: Row[] = chunk.toArray();
          if (!batch.length) break;
          let stop = false;
          for (const row of batch) {
            rows.push(String(row.value));
            if (typeof row.at !== "number" || row.at <= command.since) { stop = true; break; }
          }
          if (stop) break;
          before = Number(batch[batch.length - 1]!.seq);
          page *= 4;
        }
        return rows.reverse();
      }
      // 尾部裁剪按序号跨度：列表只从头裁掉，序号连续，跨度等于条数；按条数定边界要走 OFFSET 扫一遍。
      case "trim": {
        if (!this.requireKind(key, "list")) return true;
        if (command.start < 0 && command.stop === -1) {
          const last = this.sql.exec("SELECT MAX(seq) AS n FROM samples WHERE key = ?", key).toArray()[0]?.n;
          if (last === null || last === undefined) {
            this.remove(key);
            return true;
          }
          this.sql.exec("DELETE FROM samples WHERE key = ? AND seq <= ?", key, Number(last) + command.start);
          return true;
        }
        const [offset, limit] = this.range(this.count(key), command.start, command.stop);
        if (!limit) { this.remove(key); return true; }
        this.sql.exec("DELETE FROM samples WHERE key = ? AND seq NOT IN (SELECT seq FROM samples WHERE key = ? ORDER BY seq LIMIT ? OFFSET ?)", key, key, limit, offset);
        return true;
      }
    }
  }

  purgeExpired(): number {
    return this.transaction(() => {
      const rows = this.sql.exec("SELECT key FROM entries WHERE expires_at <= ? LIMIT 1000", this.now()).toArray();
      for (const row of rows) this.remove(String(row.key));
      return rows.length;
    });
  }

  updateIndexedString(indexKey: string, member: string, valueKey: string, value: string | null, ttlMs: number): string[] {
    return this.transaction(() => {
      const raw = this.command({ op: "get", key: indexKey });
      let current: string[] = [];
      if (typeof raw === "string") {
        try {
          const decoded: unknown = JSON.parse(raw);
          if (Array.isArray(decoded) && decoded.every((item) => typeof item === "string")) current = decoded;
        } catch { }
      }
      const next = value === null
        ? current.filter((item) => item !== member)
        : current.includes(member) ? current : [...current, member];
      this.command(value === null
        ? { op: "remove", key: valueKey }
        : { op: "set", key: valueKey, value, options: { ttlMs } });
      this.command({ op: "set", key: indexKey, value: JSON.stringify(next), options: { ttlMs } });
      return next;
    });
  }

  importMissing(entries: StoredEntry[]): number {
    return this.transaction(() => {
      let imported = 0;
      for (const entry of entries) {
        if (this.entry(entry.key) || (entry.expiresAt !== null && entry.expiresAt <= this.now())) continue;
        if (entry.kind === "string" && typeof entry.value === "string") this.command({ op: "set", key: entry.key, value: entry.value });
        else if (entry.kind === "hash" && entry.value && typeof entry.value === "object" && !Array.isArray(entry.value)) this.command({ op: "patch", key: entry.key, fields: entry.value });
        else if (entry.kind === "list" && Array.isArray(entry.value)) this.command({ op: "append", key: entry.key, values: entry.value });
        else throw new Error("Invalid imported entry");
        if (entry.expiresAt !== null) this.sql.exec("UPDATE entries SET expires_at = ? WHERE key = ?", entry.expiresAt, entry.key);
        imported++;
      }
      return imported;
    });
  }
}
