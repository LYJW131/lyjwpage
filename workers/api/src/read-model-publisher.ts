import { isPublicBody, readModelKey, readModelPolicy, type PublicReadModel, type ReadModelKv } from "./read-model.ts";

type SqlValue = string | number | null;
export interface PublicationSql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}
const COALESCE_MS = 2_000;
const RETRY_MS = 60_000;
/** The alarm awaits an ordinary-Worker renderer; a hung render must not stall the TTL sweeper. */
const RENDER_TIMEOUT_MS = 15_000;

async function boundedRender(render: () => Promise<Response>, timeoutMs: number): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      render(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Public view render timeout")), timeoutMs); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/**
 * Single-writer, durable publication queue. DO SQLite remains authoritative.
 * Queue state and the retry deadline survive hibernation/restarts. KV writes are
 * never awaited by ingest; the DO alarm calls flush after the acknowledgement.
 */
export class ReadModelPublisher {
  private flushing = false;
  private sql: PublicationSql;
  private kv: ReadModelKv;
  private prefix: string;
  private render: (path: string) => Promise<Response>;
  private now: () => number;
  private log: (path: string, error: unknown) => void;
  private renderTimeoutMs: number;

  constructor(options: {
    sql: PublicationSql; kv: ReadModelKv; prefix: string;
    render: (path: string) => Promise<Response>;
    now?: () => number;
    log?: (path: string, error: unknown) => void;
    renderTimeoutMs?: number;
  }) {
    this.sql = options.sql; this.kv = options.kv; this.prefix = options.prefix;
    this.render = options.render; this.now = options.now ?? Date.now;
    this.renderTimeoutMs = options.renderTimeoutMs ?? RENDER_TIMEOUT_MS;
    this.log = options.log ?? ((path, error) => console.warn("[read-model]", path, error instanceof Error ? error.message : String(error)));
    this.sql.exec(`CREATE TABLE IF NOT EXISTS public_read_model_jobs (
      path TEXT PRIMARY KEY, revision INTEGER NOT NULL, published_revision INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL, not_before INTEGER NOT NULL DEFAULT 0
    )`);
  }

  enqueue(paths: readonly string[]): void {
    const now = this.now();
    for (const path of new Set(paths)) {
      const policy = readModelPolicy(path);
      if (!policy) continue;
      // New arrivals must not keep moving a pending job into the future.
      this.sql.exec(`INSERT INTO public_read_model_jobs(path, revision, next_at) VALUES (?, 1, ?)
        ON CONFLICT(path) DO UPDATE SET revision = revision + 1,
        next_at = MAX(not_before, MIN(next_at, excluded.next_at))`,
      path, now + COALESCE_MS);
    }
  }

  nextAlarm(): number | null {
    const row = this.sql.exec("SELECT MIN(next_at) AS at FROM public_read_model_jobs WHERE revision > published_revision").toArray()[0];
    return typeof row?.at === "number" ? row.at : null;
  }

  async flush(limit = 3): Promise<void> {
    // Do not share a pending I/O promise across Worker request contexts.
    if (this.flushing) return;
    this.flushing = true;
    try {
      const jobs = this.sql.exec(`SELECT path FROM public_read_model_jobs
        WHERE revision > published_revision AND next_at <= ? ORDER BY next_at, path LIMIT ?`, this.now(), limit).toArray();
      for (const job of jobs) {
        const path = String(job.path);
        const policy = readModelPolicy(path);
        if (!policy) {
          // A path removed from the policy table must not keep the alarm spinning on its stale row.
          this.sql.exec("DELETE FROM public_read_model_jobs WHERE path = ?", path);
          continue;
        }
        const row = this.sql.exec("SELECT revision FROM public_read_model_jobs WHERE path = ?", path).toArray()[0];
        const revision = Number(row?.revision);
        const generatedAt = this.now();
        // Persist the deadline before any network operation, including uncertain puts.
        this.sql.exec("UPDATE public_read_model_jobs SET not_before = ?, next_at = ? WHERE path = ?",
          generatedAt + RETRY_MS, generatedAt + RETRY_MS, path);
        try {
          const response = await boundedRender(() => this.render(path), this.renderTimeoutMs);
          if (response.status !== 200 || !response.headers.get("Content-Type")?.includes("application/json")) {
            throw new Error(`Public view returned ${response.status}`);
          }
          const body = await response.text();
          if (!isPublicBody(body) || this.now() - generatedAt >= policy.maxAgeMs) {
            throw new Error("Public view is invalid or already stale");
          }
          const value: PublicReadModel = { schema: 1, path, revision, generatedAt, body };
          // Interval is measured from completion as well as start: a slow render must
          // not let the next dirty generation put the same key immediately afterwards.
          const puttingAt = this.now();
          this.sql.exec("UPDATE public_read_model_jobs SET not_before = ?, next_at = ? WHERE path = ?",
            puttingAt + RETRY_MS, puttingAt + RETRY_MS, path);
          await this.kv.put(readModelKey(this.prefix, path), JSON.stringify(value), {
            expirationTtl: Math.ceil(policy.maxAgeMs / 1_000) + 60,
          });
          const completedAt = this.now();
          this.sql.exec(`UPDATE public_read_model_jobs SET published_revision = MAX(published_revision, ?),
            not_before = ?, next_at = ? WHERE path = ?`, revision, completedAt + policy.intervalMs, completedAt + policy.intervalMs, path);
          // A report accepted during render/put has a higher revision and stays dirty.
        } catch (error) {
          const failedAt = this.now();
          this.sql.exec("UPDATE public_read_model_jobs SET not_before = ?, next_at = ? WHERE path = ?",
            failedAt + RETRY_MS, failedAt + RETRY_MS, path);
          this.log(path, error);
        }
      }
    } finally { this.flushing = false; }
  }
}
