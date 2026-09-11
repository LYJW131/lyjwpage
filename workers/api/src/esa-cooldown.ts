import type { SqlDatabase } from "@shared/sqlite-store";

/**
 * 刷新提交到全网生效约 5~6 分钟，间隔短于这个数只会让多个刷新任务排队互相覆盖、
 * 缓存永远处在失效边缘。600 秒是过渡值：等 ESA 控制台把首页规则切到「优先遵循
 * 源站缓存策略」，源站的 stale-while-revalidate 会接管，整条刷新链路即可删除。
 */
export const ESA_COOLDOWN_MS = 600_000;

/** 单个 StateHub 的持久冷却；同步领取发送资格，冷却内变化由 alarm 合并补发。 */
export class EsaCooldown {
  private sql: SqlDatabase;
  private schedule: (at: number) => Promise<void>;
  private purge: () => Promise<void>;
  private now: () => number;

  constructor(sql: SqlDatabase, schedule: (at: number) => Promise<void>, purge: () => Promise<void>, now = Date.now) {
    this.sql = sql; this.schedule = schedule; this.purge = purge; this.now = now;
    sql.exec("CREATE TABLE IF NOT EXISTS esa_purge (id INTEGER PRIMARY KEY CHECK(id = 1), next_at INTEGER NOT NULL, pending INTEGER NOT NULL)");
    sql.exec("INSERT OR IGNORE INTO esa_purge VALUES (1, 0, 0)");
  }

  request(): Promise<void> {
    this.sql.exec("UPDATE esa_purge SET pending = 1 WHERE id = 1 AND pending = 0");
    return this.flush();
  }

  async flush(): Promise<void> {
    const row = this.sql.exec("SELECT next_at, pending FROM esa_purge WHERE id = 1").toArray()[0];
    if (!row?.pending) return;
    const now = this.now();
    if (Number(row.next_at) > now) {
      await this.schedule(Number(row.next_at));
      return;
    }
    // 在首个 await 前持久化资格，避免并发请求、重启或 alarm 重试绕过间隔。
    this.sql.exec("UPDATE esa_purge SET next_at = ?, pending = 0 WHERE id = 1", now + ESA_COOLDOWN_MS);
    await this.purge();
  }
}
