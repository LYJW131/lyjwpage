import { EsaCooldown } from "./esa-cooldown";
import { purgeEsaHomepage } from "./esa-cache";
import { withRequestState } from "@shared/request-state";
import { publicResponse } from "./public-api";
import { DurableObject } from "cloudflare:workers";
import { StorageClient } from "@shared/storage-client";
import { SqliteStore, type StoredEntry } from "@shared/sqlite-store";
import type { StorageCommand } from "@shared/storage-contract";
import { HANDLERS } from "./ingest-handlers";
import { requestStore, type Env } from "./runtime";

/** 单个站点一个对象。所有上报的读、合并、写按顺序完成，避免不同信封互相覆盖。 */
export class StateHub extends DurableObject<Env> {
  private database: SqliteStore;
  private esaCooldown: EsaCooldown;
  private ingestTail: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.database = new SqliteStore(ctx.storage.sql, (work) => ctx.storage.transactionSync(work));
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.esaCooldown = new EsaCooldown(ctx.storage.sql, (at) => this.scheduleAlarm(at), () => purgeEsaHomepage(this.env));
  }

  ready(): boolean {
    return this.ctx.storage.sql.exec("SELECT value FROM metadata WHERE key = 'initialized'").toArray()[0]?.value === "1";
  }
  finishImport(): void {
    this.ctx.storage.sql.exec("INSERT INTO metadata(key, value) VALUES ('initialized', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.ready()) return Response.json({ ok: false, error: "状态存储初始化中" }, { status: 503 });
    // 等已接受的写入完成，读取使用自己的工作副本；不与其他请求共享 Promise 或状态对象。
    await this.ingestTail;
    return withRequestState(() => requestStore.run({ env: this.env, ctx: this.ctx,
      storage: new StorageClient(async (commands) => this.database.execute(commands)),
      requestEsaPurge: () => this.requestEsaPurge(),
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
      requestEsaPurge: () => this.requestEsaPurge(),
    }, async () => {
      const data = await handler(body);
      await this.ensureAlarm();
      return { ready: true, json: JSON.stringify(data) };
    })));
    this.ingestTail = result.catch(() => {});
    return result;
  }

  async importMissing(entries: StoredEntry[]): Promise<number> {
    const count = this.database.importMissing(entries);
    await this.ensureAlarm();
    return count;
  }
  async requestEsaPurge(): Promise<void> {
    if (!this.env.ALIYUN_ACCESS_KEY_ID || !this.env.ALIYUN_ACCESS_KEY_SECRET || !this.env.ESA_SITE_ID || !this.env.ESA_CACHE_URL) {
      await purgeEsaHomepage(this.env);
      return;
    }
    await this.esaCooldown.request();
  }
  private async scheduleAlarm(at: number): Promise<void> {
    // ESA 补发和存储清理共享唯一 alarm；事务内只将时间提前，不能互相覆盖。
    await this.ctx.storage.transaction(async (txn) => {
      const current = await txn.getAlarm();
      if (current === null || current > at) await txn.setAlarm(at);
    });
  }
  private ensureAlarm(): Promise<void> {
    return this.scheduleAlarm(Date.now() + 60 * 60_000);
  }
  async alarm(): Promise<void> {
    await this.esaCooldown.flush();
    const removed = this.database.purgeExpired();
    await this.scheduleAlarm(Date.now() + (removed === 1000 ? 1000 : 60 * 60_000));
  }
}
