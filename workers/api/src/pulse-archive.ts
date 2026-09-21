import { parsePulseSample, pulseKey } from "@/lib/pulse";
import { PULSE_DOMAINS, type PulseDomain, type PulseSample } from "@/lib/types";
import type { StorageClient } from "@shared/storage-client";

type SqlValue = string | number | null;
/** StateHub 的 `metadata` 表，水位线存在这里；和 ReadModelPublisher 一样只要 `exec`。 */
export interface ArchiveSql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}
/**
 * D1 只用到 `prepare().bind()` 和 `batch()`，按结构写成最小接口，测试可以塞假实现。
 * 方法简写不是风格问题：属性式函数类型在 `strictFunctionTypes` 下逆变，`D1Database`
 * 的 `batch(statements: D1PreparedStatement[])` 就赋不进来了。
 */
export interface PulseArchiveDb {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
  batch(statements: unknown[]): Promise<unknown>;
}

const INSERT = "INSERT OR IGNORE INTO pulse_samples(domain, t, level, hint, until_at, power_w) VALUES (?, ?, ?, ?, ?, ?)";
/** 一批语句的上限，D1 对单次 batch 的语句数有限制，分块也让失败只丢一小段。 */
const CHUNK_SIZE = 100;
const WATERMARK_PREFIX = "pulse-archive:";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把 StateHub 的 pulse 序列镜像进 D1，作长期备份。
 *
 * StateHub 每域只留 600 条 / 7 天，是唯一权威；D1 只增不删，没有公开读路径。
 * 由 cron 每分钟从 StateHub 驱动一次，不挂在上报路径上：上报不等 D1，归档失败也
 * 不该让上报或 cron 失败。每域一条水位线（已归档的最大 `t`），只有 batch 成功
 * 落地后才前进，失败就留在原处等下一分钟重试；`INSERT OR IGNORE` 让重放无害。
 */
export class PulseArchive {
  private sql: ArchiveSql;
  private db: PulseArchiveDb;
  private storage: StorageClient;
  private chunkSize: number;
  private log: (domain: string, error: unknown) => void;
  /** 两次 cron 撞上时不重复写；INSERT OR IGNORE 本来也挡得住，这里省掉无谓的往返。 */
  private running = false;

  constructor(options: {
    sql: ArchiveSql;
    db: PulseArchiveDb;
    storage: StorageClient;
    chunkSize?: number;
    log?: (domain: string, error: unknown) => void;
  }) {
    this.sql = options.sql;
    this.db = options.db;
    this.storage = options.storage;
    this.chunkSize = options.chunkSize ?? CHUNK_SIZE;
    this.log = options.log ?? ((domain, error) => console.warn("[pulse-archive]", domain, reason(error)));
  }

  /** 一域出错只丢这一域，其余照常；异常不外抛，调用方（cron）不该因为归档失败而失败。 */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const domain of PULSE_DOMAINS) {
        try {
          await this.archiveDomain(domain);
        } catch (error) {
          this.log(domain, error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private watermark(domain: PulseDomain): number {
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", WATERMARK_PREFIX + domain).toArray()[0];
    const at = Number(row?.value);
    return Number.isFinite(at) ? at : 0;
  }

  private advance(domain: PulseDomain, t: number): void {
    this.sql.exec(
      "INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      WATERMARK_PREFIX + domain,
      String(t),
    );
  }

  private async pending(domain: PulseDomain): Promise<PulseSample[]> {
    const watermark = this.watermark(domain);
    const rows = await this.storage.listRange(pulseKey(domain), 0, -1);
    const samples: PulseSample[] = [];
    for (const raw of rows) {
      const sample = parsePulseSample(raw);
      if (sample && sample.t > watermark) samples.push(sample);
    }
    // 列表本来就是按 t 递增追加的；排一次是为了分块推进水位线时每块的末尾就是这块的最大值。
    return samples.sort((a, b) => a.t - b.t);
  }

  private async archiveDomain(domain: PulseDomain): Promise<void> {
    const samples = await this.pending(domain);
    // 没有新样本就完全不碰 D1。绝大多数分钟走的是这条。
    if (!samples.length) return;
    for (let at = 0; at < samples.length; at += this.chunkSize) {
      const chunk = samples.slice(at, at + this.chunkSize);
      await this.db.batch(chunk.map((sample) => this.db.prepare(INSERT).bind(
        domain,
        sample.t,
        sample.level,
        // undefined 会让 D1 抛 D1_TYPE_ERROR，没有 hint 的样本必须显式写 null。
        sample.hint ?? null,
        sample.until ?? null, sample.powerW ?? null,
      )));
      this.advance(domain, chunk[chunk.length - 1].t);
    }
  }
}
