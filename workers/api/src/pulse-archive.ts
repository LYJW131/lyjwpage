import { parsePulseSample, pulseKey } from "@/lib/pulse";
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
  watermark: number;
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
const CHUNK_SIZE = 100;
const WATERMARK_PREFIX = "pulse-archive:";
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
    const domains: PulseArchiveDomainSnapshot[] = [];
    for (const domain of PULSE_DOMAINS) {
      try {
        const rows = this.execute([{
          op: "listRange",
          key: pulseKey(domain),
          start: 0,
          stop: (domain === "charging" ? CHARGING_HISTORY_LIMIT : PULSE_HISTORY_LIMIT) - 1,
        }])[0] as string[];
        domains.push({ domain, watermark: this.watermark(domain), rows });
      } catch (error) {
        domains.push({ domain, watermark: 0, rows: [], error: reason(error) });
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
      if (sample && sample.t > snapshot.watermark) samples.push(sample);
    }
    samples.sort((a, b) => a.t - b.t);

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
