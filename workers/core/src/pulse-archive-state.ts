import { codingObservationsKey, cursorObservationsKey } from "./coding-pulse";
import {
  ARCHIVE_STREAMS,
  DAY_MS,
  parsedJson,
  reason,
  revisionOf,
  siteDayStart,
  type ArchiveSql,
  type ArchiveStream,
  type PulseArchiveCoordinator,
  type PulseArchiveSnapshot,
  type PulseArchiveStreamSnapshot,
} from "./pulse-archive-snapshot";
import {
  pulseActivityKey,
  pulseActivityRangeKey,
  pulseActivityRevisionKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseListeningTracesKey,
} from "./pulse-keys";
import { parseStoredCodingBuckets } from "@shared/coding-buckets";
import { codingBucketsKey, codingUsageKey, codingUsageRevisionKey, parseRevision } from "@shared/coding-store";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { CODING_OBSERVATION_HOLD_MS } from "@shared/pulse-coding";
import { CHARGING_IDLE_MAX_W } from "@shared/home-layout";
import type { StorageCommand } from "@shared/storage-contract";

const WATERMARK_PREFIX = "pulse-archive:v2:";
const REVISION_KEY = "pulse-archive:revision";
const ACTIVITY_REPLACED_KEY = "pulse-archive:v2:activity-replaced";
const SESSION_CONTEXT_MS = 2 * DAY_MS;

export class PulseArchiveState implements PulseArchiveCoordinator {
  private sql: ArchiveSql;
  private execute: (commands: StorageCommand[]) => unknown[];
  private now: () => number;

  constructor(options: {
    sql: ArchiveSql;
    execute: (commands: StorageCommand[]) => unknown[];
    now?: () => number;
  }) {
    this.sql = options.sql;
    this.execute = options.execute;
    this.now = options.now ?? Date.now;
  }

  async readPulseArchive(): Promise<PulseArchiveSnapshot> {
    const revision = this.nextRevision();
    const now = this.now();
    const streams: PulseArchiveStreamSnapshot[] = [];
    for (const stream of ARCHIVE_STREAMS) {
      const watermark = this.watermark(stream);
      try {
        streams.push({ stream, revision, watermark, ...this.readStream(stream, watermark) });
      } catch (error) {
        streams.push({ stream, revision, watermark, rows: [], error: reason(error) });
      }
    }
    return { now, streams };
  }

  private readStream(stream: ArchiveStream, watermark: number): Omit<PulseArchiveStreamSnapshot, "stream" | "revision" | "watermark"> {
    switch (stream) {
      case "listening":
        return { rows: this.readSince(pulseLaneKey(stream), watermark, "to") };
      case "gaming": case "watching":
        return { rows: this.readSince(pulseLaneKey(stream), watermark - SESSION_CONTEXT_MS, "to",
          (row) => (stream === "gaming" ? row.state === "in-game" : row.state !== "idle")) };
      case "listening-traces":
        return { rows: this.readSince(pulseListeningTracesKey(), watermark, "t") };
      case "charging":
        return { rows: this.readSince(pulseChargingKey(), watermark - SESSION_CONTEXT_MS, "t",
          (row) => typeof row.watts === "number" && row.watts > CHARGING_IDLE_MAX_W) };
      case "coding": {
        const since = siteDayStart(watermark);
        return { rows: this.readSince(codingObservationsKey(), since, "t"), extra: this.readSince(cursorObservationsKey(), since - CODING_OBSERVATION_HOLD_MS, "t") };
      }
      case "activity": {
        const [rows, range, revision] = this.execute([
          { op: "listRange", key: pulseActivityKey(), start: 0, stop: -1 },
          { op: "get", key: pulseActivityRangeKey() },
          { op: "get", key: pulseActivityRevisionKey() },
        ]) as [string[], string | null, string | null];
        const parsed = typeof range === "string" ? JSON.parse(range) as { from?: unknown; to?: unknown } : null;
        const replaceRange = parsed && Number.isSafeInteger(parsed.from) && Number.isSafeInteger(parsed.to) && (parsed.from as number) < (parsed.to as number)
          ? { from: parsed.from as number, to: parsed.to as number }
          : undefined;
        const replaceToken = replaceRange ? JSON.stringify([revision ?? null, replaceRange.from, replaceRange.to]) : undefined;
        const pending = replaceToken !== undefined && replaceToken !== this.metadata(ACTIVITY_REPLACED_KEY);
        return pending ? { rows, replaceRange, replaceToken } : { rows: [] };
      }
      case "coding-usage": {
        const [rawRevision] = this.execute([{ op: "get", key: codingUsageRevisionKey() }]) as [string | null];
        if (parseRevision(rawRevision) <= watermark) return { rows: [] };
        const hashes = this.execute(CODING_USAGE_SOURCE_NAMES.map((source): StorageCommand => ({ op: "fields", key: codingUsageKey(source) }))) as Record<string, string>[];
        const coding: Partial<Record<CodingUsageSource, string[]>> = {};
        CODING_USAGE_SOURCE_NAMES.forEach((source, index) => {
          const changed = Object.values(hashes[index] ?? {}).filter((raw) => revisionOf(parsedJson<{ revision?: unknown }>(raw)) > watermark);
          if (changed.length) coding[source] = changed;
        });
        return { rows: [], coding };
      }
      case "coding-buckets": {
        const values = this.execute(CODING_USAGE_SOURCE_NAMES.map((source): StorageCommand => ({ op: "get", key: codingBucketsKey(source) }))) as (string | null)[];
        const coding: Partial<Record<CodingUsageSource, string[]>> = {};
        CODING_USAGE_SOURCE_NAMES.forEach((source, index) => {
          const raw = values[index];
          const stored = parseStoredCodingBuckets(raw);
          if (raw && stored && revisionOf(stored) > watermark) coding[source] = [raw];
        });
        return { rows: [], coding };
      }
    }
  }

  // 回看边界若落在会话中，必须继续读到起点；否则每轮会插入起点漂移的重叠会话。
  private readSince(listKey: string, since: number, field: "t" | "to", inSession?: (row: Record<string, unknown>) => boolean): string[] {
    for (let size = 256; ; size *= 4) {
      const rows = this.execute([{ op: "listRange", key: listKey, start: -size, stop: -1 }])[0] as string[];
      if (rows.length < size) return rows;
      let first: Record<string, unknown>;
      try { first = JSON.parse(rows[0]) as Record<string, unknown>; } catch { return rows; }
      const at = first[field];
      if (typeof at === "number" && at > since) continue;
      if (!inSession?.(first)) return rows;
    }
  }

  async confirmPulseArchive(stream: ArchiveStream, at: number, replaceToken?: string): Promise<number> {
    if (!ARCHIVE_STREAMS.includes(stream) || !Number.isSafeInteger(at) || at < 0 ||
        (replaceToken !== undefined && (stream !== "activity" || typeof replaceToken !== "string"))) {
      throw new Error("Invalid Pulse archive confirmation");
    }
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
      WATERMARK_PREFIX + stream,
      String(at),
    );
    return this.watermark(stream);
  }

  private watermark(stream: ArchiveStream): number {
    const at = Number(this.metadata(WATERMARK_PREFIX + stream));
    return Number.isFinite(at) ? at : 0;
  }

  private metadata(name: string): string | null {
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", name).toArray()[0];
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
