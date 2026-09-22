import { parsePulseSample, pulseIntervalRangeKey, pulseIntervalRevisionKey, pulseKey } from "@/lib/pulse";
import { PULSE_HISTORY_LIMIT } from "@/lib/limits";
import { PULSE_DOMAINS, type PulseDomain, type PulseSample } from "@/lib/types";
import type { StorageCommand } from "@shared/storage-contract";

type SqlValue = string | number | null;
/** StateHub's metadata table. */
export interface ArchiveSql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}

/** Minimal D1 surface used by the ordinary Worker executor. */
export interface PulseArchiveDb {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
  batch(statements: unknown[]): Promise<unknown>;
}

export type PulseArchiveDomainSnapshot = {
  domain: PulseDomain;
  /** StateHub 分配的单调快照版本；防止较旧的异步归档覆盖较新的修订。 */
  revision: number;
  watermark: number;
  replaceRange?: { from: number; to: number };
  /** 本次权威替换对应的 StateHub 版本；确认后同一份历史不再重复写 D1。 */
  replaceToken?: string;
  /** Raw authoritative rows; parsing and sorting are Worker work. */
  rows: string[];
  /** A broken domain remains isolated inside the single coordinator RPC. */
  error?: string;
};

export type PulseArchiveSnapshot = { domains: PulseArchiveDomainSnapshot[] };

/** RPC shape implemented by StateHub and consumed by the ordinary Worker executor. */
export interface PulseArchiveCoordinator {
  readPulseArchive(): Promise<PulseArchiveSnapshot>;
  confirmPulseArchive(domain: PulseDomain, t: number, replaceToken?: string): Promise<number>;
}

const INSERT = "INSERT OR IGNORE INTO pulse_samples(domain, t, level, hint, until_at, power_w) VALUES (?, ?, ?, ?, ?, ?)";
const CLAIM_ACTIVITY_REVISION = `INSERT INTO pulse_archive_state(domain, revision) VALUES ('activity', ?)
  ON CONFLICT(domain) DO UPDATE SET revision = MAX(revision, excluded.revision)`;
// 新快照里仍在的桶交给下面的 upsert，只删真正消失的；未变的行不产生 D1 写入。
const DELETE_ACTIVITY_RANGE = `DELETE FROM pulse_samples WHERE domain = 'activity' AND t < ? AND COALESCE(until_at, t + 1) > ?
  AND t NOT IN (SELECT json_extract(value, '$.t') FROM json_each(?))
  AND (SELECT revision FROM pulse_archive_state WHERE domain = 'activity') = ?`;
const REPLACE_ACTIVITY = `INSERT INTO pulse_samples(domain, t, level, hint, until_at, power_w)
  SELECT 'activity', json_extract(value, '$.t'), json_extract(value, '$.level'), NULL,
    json_extract(value, '$.until'), NULL FROM json_each(?)
  WHERE (SELECT revision FROM pulse_archive_state WHERE domain = 'activity') = ?
  ON CONFLICT(domain, t) DO UPDATE SET level = excluded.level, hint = NULL,
    until_at = excluded.until_at, power_w = NULL
  WHERE pulse_samples.level IS NOT excluded.level OR pulse_samples.until_at IS NOT excluded.until_at
    OR pulse_samples.hint IS NOT NULL OR pulse_samples.power_w IS NOT NULL`;
const CHUNK_SIZE = 100;
const WATERMARK_PREFIX = "pulse-archive:";
const REVISION_KEY = "pulse-archive:revision";
const ACTIVITY_REPLACED_KEY = "pulse-archive:activity-replaced";
const CHARGING_HISTORY_LIMIT = 6000;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Durable state half of Pulse archiving. It exposes one bounded snapshot RPC
 * with per-domain read isolation and monotonic acknowledgements; it never talks to D1.
 */
export class PulseArchiveState implements PulseArchiveCoordinator {
  private sql: ArchiveSql;
  private execute: (commands: StorageCommand[]) => unknown[];

  constructor(options: {
    sql: ArchiveSql;
    execute: (commands: StorageCommand[]) => unknown[];
  }) {
    this.sql = options.sql;
    this.execute = options.execute;
  }

  async readPulseArchive(): Promise<PulseArchiveSnapshot> {
    const revision = this.nextRevision();
    const domains: PulseArchiveDomainSnapshot[] = [];
    for (const domain of PULSE_DOMAINS) {
      try {
        const commands: StorageCommand[] = [{
          op: "listRange",
          key: pulseKey(domain),
          start: 0,
          stop: (domain === "charging" ? CHARGING_HISTORY_LIMIT : PULSE_HISTORY_LIMIT) - 1,
        }];
        if (domain === "activity") {
          commands.push(
            { op: "get", key: pulseIntervalRangeKey("activity") },
            { op: "get", key: pulseIntervalRevisionKey("activity") },
          );
        }
        const result = this.execute(commands);
        const rows = result[0] as string[];
        const parsedRange = domain === "activity" && typeof result[1] === "string"
          ? JSON.parse(result[1]) as { from?: unknown; to?: unknown }
          : null;
        const replaceRange = parsedRange && Number.isSafeInteger(parsedRange.from) && Number.isSafeInteger(parsedRange.to) &&
          (parsedRange.from as number) < (parsedRange.to as number)
          ? { from: parsedRange.from as number, to: parsedRange.to as number }
          : undefined;
        // 范围或事实版本没变就是 D1 已有的那一份；每分钟重放会白白删了又写几百行。
        const replaceToken = replaceRange ? JSON.stringify([result[2] ?? null, replaceRange.from, replaceRange.to]) : undefined;
        const pending = replaceToken !== undefined && replaceToken !== this.metadata(ACTIVITY_REPLACED_KEY);
        domains.push({
          domain,
          revision,
          watermark: this.watermark(domain),
          rows,
          ...(pending ? { replaceRange, replaceToken } : {}),
        });
      } catch (error) {
        domains.push({ domain, revision, watermark: 0, rows: [], error: reason(error) });
      }
    }
    return { domains };
  }

  async confirmPulseArchive(domain: PulseDomain, t: number, replaceToken?: string): Promise<number> {
    if (!PULSE_DOMAINS.includes(domain) || !Number.isSafeInteger(t) || t < 0 ||
        (replaceToken !== undefined && (domain !== "activity" || typeof replaceToken !== "string"))) {
      throw new Error("Invalid Pulse archive confirmation");
    }
    // 较旧的任务晚确认只会让下一分钟多做一次无变化的替换，D1 的范围版本保证不回退数据。
    if (replaceToken !== undefined) {
      this.sql.exec(
        `INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ACTIVITY_REPLACED_KEY,
        replaceToken,
      );
    }
    this.sql.exec(
      `INSERT INTO metadata(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CASE
         WHEN CAST(excluded.value AS INTEGER) > CAST(metadata.value AS INTEGER) THEN excluded.value
         ELSE metadata.value
       END`,
      WATERMARK_PREFIX + domain,
      String(t),
    );
    return this.watermark(domain);
  }

  private watermark(domain: PulseDomain): number {
    const at = Number(this.metadata(WATERMARK_PREFIX + domain));
    return Number.isFinite(at) ? at : 0;
  }

  private metadata(key: string): string | null {
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", key).toArray()[0];
    return typeof row?.value === "string" ? row.value : null;
  }

  private nextRevision(): number {
    this.sql.exec(
      `INSERT INTO metadata(key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(metadata.value AS INTEGER) + 1`,
      REVISION_KEY,
    );
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", REVISION_KEY).toArray()[0];
    return Number(row?.value) || 1;
  }
}

/**
 * Ordinary Worker half of Pulse archiving. D1 inserts are idempotent through the
 * (domain, t) primary key and INSERT OR IGNORE, so concurrent runs may safely
 * replay a chunk. Each successful chunk advances only its monotonic DO watermark.
 */
export class PulseArchive {
  private coordinator: PulseArchiveCoordinator;
  private db: PulseArchiveDb;
  private chunkSize: number;
  private log: (domain: string, error: unknown) => void;

  constructor(options: {
    coordinator: PulseArchiveCoordinator;
    db: PulseArchiveDb;
    chunkSize?: number;
    log?: (domain: string, error: unknown) => void;
  }) {
    this.coordinator = options.coordinator;
    this.db = options.db;
    this.chunkSize = options.chunkSize ?? CHUNK_SIZE;
    this.log = options.log ?? ((domain, error) => console.warn("[pulse-archive]", domain, reason(error)));
  }

  /** One domain failing does not block the other five. */
  async run(): Promise<void> {
    const snapshot = await this.coordinator.readPulseArchive();
    for (const domain of snapshot.domains) {
      try {
        await this.archiveDomain(domain);
      } catch (error) {
        this.log(domain.domain, error);
      }
    }
  }

  private async archiveDomain(snapshot: PulseArchiveDomainSnapshot): Promise<void> {
    if (snapshot.error) throw new Error(snapshot.error);
    const samples: PulseSample[] = [];
    for (const raw of snapshot.rows) {
      const sample = parsePulseSample(raw);
      if (sample && ((snapshot.domain === "activity" && snapshot.replaceRange) || sample.t > snapshot.watermark)) samples.push(sample);
    }
    samples.sort((a, b) => a.t - b.t);

    if (snapshot.domain === "activity" && snapshot.replaceRange) {
      const json = JSON.stringify(samples);
      await this.db.batch([
        this.db.prepare(CLAIM_ACTIVITY_REVISION).bind(snapshot.revision),
        this.db.prepare(DELETE_ACTIVITY_RANGE).bind(snapshot.replaceRange.to, snapshot.replaceRange.from, json, snapshot.revision),
        this.db.prepare(REPLACE_ACTIVITY).bind(json, snapshot.revision),
      ]);
      const last = samples.length ? samples[samples.length - 1].t : snapshot.watermark;
      await this.coordinator.confirmPulseArchive(snapshot.domain, last, snapshot.replaceToken);
      return;
    }

    for (let at = 0; at < samples.length; at += this.chunkSize) {
      const chunk = samples.slice(at, at + this.chunkSize);
      await this.db.batch(chunk.map((sample) => this.db.prepare(INSERT).bind(
        snapshot.domain,
        sample.t,
        sample.level,
        sample.hint ?? null,
        sample.until ?? null,
        sample.powerW ?? null,
      )));
      await this.coordinator.confirmPulseArchive(snapshot.domain, chunk[chunk.length - 1].t);
    }
  }
}
