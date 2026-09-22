import { parsePulseSample, pulseIntervalRangeKey, pulseKey } from "@/lib/pulse";
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
  /** Raw authoritative rows; parsing and sorting are Worker work. */
  rows: string[];
  /** A broken domain remains isolated inside the single coordinator RPC. */
  error?: string;
};

export type PulseArchiveSnapshot = { domains: PulseArchiveDomainSnapshot[] };

/** RPC shape implemented by StateHub and consumed by the ordinary Worker executor. */
export interface PulseArchiveCoordinator {
  readPulseArchive(): Promise<PulseArchiveSnapshot>;
  confirmPulseArchive(domain: PulseDomain, t: number): Promise<number>;
}

const INSERT = "INSERT OR IGNORE INTO pulse_samples(domain, t, level, hint, until_at, power_w) VALUES (?, ?, ?, ?, ?, ?)";
const CLAIM_ACTIVITY_REVISION = `INSERT INTO pulse_archive_state(domain, revision) VALUES ('activity', ?)
  ON CONFLICT(domain) DO UPDATE SET revision = MAX(revision, excluded.revision)`;
const DELETE_ACTIVITY_RANGE = `DELETE FROM pulse_samples WHERE domain = 'activity' AND t < ? AND COALESCE(until_at, t + 1) > ?
  AND (SELECT revision FROM pulse_archive_state WHERE domain = 'activity') = ?`;
const REPLACE_ACTIVITY = `INSERT INTO pulse_samples(domain, t, level, hint, until_at, power_w)
  SELECT 'activity', json_extract(value, '$.t'), json_extract(value, '$.level'), NULL,
    json_extract(value, '$.until'), NULL FROM json_each(?)
  WHERE (SELECT revision FROM pulse_archive_state WHERE domain = 'activity') = ?
  ON CONFLICT(domain, t) DO UPDATE SET level = excluded.level, hint = NULL,
    until_at = excluded.until_at, power_w = NULL`;
const CHUNK_SIZE = 100;
const WATERMARK_PREFIX = "pulse-archive:";
const REVISION_KEY = "pulse-archive:revision";
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
        if (domain === "activity") commands.push({ op: "get", key: pulseIntervalRangeKey("activity") });
        const result = this.execute(commands);
        const rows = result[0] as string[];
        const parsedRange = domain === "activity" && typeof result[1] === "string"
          ? JSON.parse(result[1]) as { from?: unknown; to?: unknown }
          : null;
        const replaceRange = parsedRange && Number.isSafeInteger(parsedRange.from) && Number.isSafeInteger(parsedRange.to) &&
          (parsedRange.from as number) < (parsedRange.to as number)
          ? { from: parsedRange.from as number, to: parsedRange.to as number }
          : undefined;
        domains.push({ domain, revision, watermark: this.watermark(domain), rows, ...(replaceRange ? { replaceRange } : {}) });
      } catch (error) {
        domains.push({ domain, revision, watermark: 0, rows: [], error: reason(error) });
      }
    }
    return { domains };
  }

  async confirmPulseArchive(domain: PulseDomain, t: number): Promise<number> {
    if (!PULSE_DOMAINS.includes(domain) || !Number.isSafeInteger(t) || t < 0) {
      throw new Error("Invalid Pulse archive confirmation");
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
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", WATERMARK_PREFIX + domain).toArray()[0];
    const at = Number(row?.value);
    return Number.isFinite(at) ? at : 0;
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
      await this.db.batch([
        this.db.prepare(CLAIM_ACTIVITY_REVISION).bind(snapshot.revision),
        this.db.prepare(DELETE_ACTIVITY_RANGE).bind(snapshot.replaceRange.to, snapshot.replaceRange.from, snapshot.revision),
        this.db.prepare(REPLACE_ACTIVITY).bind(JSON.stringify(samples), snapshot.revision),
      ]);
      if (samples.length) await this.coordinator.confirmPulseArchive(snapshot.domain, samples[samples.length - 1].t);
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
