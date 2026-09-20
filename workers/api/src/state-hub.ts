import { withRequestState } from "@shared/request-state";
import { publicResponse } from "./public-api";
import { DurableObject } from "cloudflare:workers";
import { StorageClient } from "@shared/storage-client";
import { SqliteStore, type StoredEntry } from "@shared/sqlite-store";
import type { StorageCommand } from "@shared/storage-contract";
import { HANDLERS } from "./ingest-handlers";
import { historyArchiveEnabled, pulseScoringEnabled, readModelEnabled, requestStore, type Env } from "./runtime";
import { PulseArchive } from "./pulse-archive";
import { PulseScorer } from "./pulse-score";
import { READ_MODEL_PATHS, readModelPathsForSource } from "./read-model";
import { ReadModelPublisher } from "./read-model-publisher";

/** Authoritative state and existing ingest coordination; public KV is a projection. */
export class StateHub extends DurableObject<Env> {
  private database: SqliteStore;
  private ingestTail: Promise<unknown> = Promise.resolve();
  private readModels: ReadModelPublisher | null;
  private pulseArchive: PulseArchive | null;
  private pulseScorer: PulseScorer | null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.database = new SqliteStore(ctx.storage.sql, (work) => ctx.storage.transactionSync(work));
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    ctx.storage.sql.exec("DROP TABLE IF EXISTS esa_purge");
    this.readModels = readModelEnabled(env) && env.READ_MODEL ? new ReadModelPublisher({
      sql: ctx.storage.sql,
      kv: env.READ_MODEL,
      prefix: env.STORAGE_PREFIX ?? "lyjwpage",
      render: (path) => this.fetch(new Request(`https://read-model.internal${path}`)),
    }) : null;
    // 归档表由 D1 迁移建好，这里不建表：少了迁移就该在日志里炸出来，不能被悄悄建上遮住。
    this.pulseArchive = historyArchiveEnabled(env) && env.HISTORY ? new PulseArchive({
      sql: ctx.storage.sql,
      db: env.HISTORY,
      storage: new StorageClient(async (commands) => this.database.execute(commands)),
    }) : null;
    // 分存在 StateHub 自己的库里（键 pulse:assessments），评分器只从这里读写，不经请求作用域。
    this.pulseScorer = pulseScoringEnabled(env) && env.TYPESAFE_API_KEY ? new PulseScorer({
      storage: new StorageClient(async (commands) => this.database.execute(commands)),
      apiKey: env.TYPESAFE_API_KEY,
    }) : null;
  }

  ready(): boolean {
    return this.ctx.storage.sql.exec("SELECT value FROM metadata WHERE key = 'initialized'").toArray()[0]?.value === "1";
  }
  async finishImport(): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO metadata(key, value) VALUES ('initialized', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
    await this.queueReadModels();
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.ready()) return Response.json({ ok: false, error: "状态存储初始化中" }, { status: 503 });
    await this.ingestTail;
    return withRequestState(() => requestStore.run({ env: this.env, ctx: this.ctx,
      storage: new StorageClient(async (commands) => this.database.execute(commands)),
    }, () => publicResponse(request)));
  }

  async execute(commands: StorageCommand[]): Promise<unknown[]> {
    const result = this.database.execute(commands);
    await this.ensureAlarm();
    return result;
  }

  ingest(source: string, body: unknown): Promise<{ ready: boolean; json: string }> {
    if (!this.ready()) return Promise.resolve({ ready: false, json: "null" });
    const handler = Object.hasOwn(HANDLERS, source) ? HANDLERS[source] : undefined;
    if (!handler) throw new Error("Unknown ingest source");
    const result = this.ingestTail.then(() => withRequestState(() => requestStore.run({
      env: this.env,
      ctx: this.ctx,
      storage: new StorageClient(async (commands) => this.database.execute(commands)),
    }, async () => {
      try {
        const data = await handler(body);
        return { ready: true, json: JSON.stringify(data) };
      } finally {
        // A handler can commit liveness before rejecting a later module. Rebuild
        // from authority even then; never put KV or render public APIs in this queue.
        this.readModels?.enqueue(readModelPathsForSource(source));
        await this.ensureAlarm();
      }
    })));
    this.ingestTail = result.catch(() => {});
    return result;
  }

  async queueReadModels(paths: string[] = [...READ_MODEL_PATHS]): Promise<void> {
    if (!this.readModels || !this.ready()) return;
    this.readModels.enqueue(paths);
    await this.ensureAlarm();
  }

  /** cron 每分钟一趟，把 pulse 序列增量镜像进 D1。错误只进日志，调用方不受影响。 */
  async archivePulse(): Promise<void> {
    if (!this.pulseArchive || !this.ready()) return;
    await this.pulseArchive.run();
  }

  /**
   * cron 每分钟一趟，由评分器自己决定要不要真打出去（统一五分钟分段评分）。
   * 错误只进 `[pulse-score]` 日志，上一份分留着。
   */
  async scorePulse(): Promise<void> {
    if (!this.pulseScorer || !this.ready()) return;
    await this.pulseScorer.run();
  }

  async importMissing(entries: StoredEntry[]): Promise<number> {
    const count = this.database.importMissing(entries);
    await this.ensureAlarm();
    return count;
  }
  private async scheduleAlarm(at: number): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      const current = await txn.getAlarm();
      if (current === null || current > at) await txn.setAlarm(at);
    });
  }
  private ensureAlarm(): Promise<void> {
    return this.scheduleAlarm(Math.max(Date.now() + 1, Math.min(
      Date.now() + 60 * 60_000, this.readModels?.nextAlarm() ?? Infinity,
    )));
  }
  async alarm(): Promise<void> {
    const removed = this.database.purgeExpired();
    await this.readModels?.flush();
    await this.scheduleAlarm(Math.max(Date.now() + 1, Math.min(
      Date.now() + (removed === 1000 ? 1000 : 60 * 60_000),
      this.readModels?.nextAlarm() ?? Infinity,
    )));
  }
}
