import type { CodingUsageSource } from "@shared/coding-usage-sources";
import type { HistoryDb } from "@shared/history-ingest";

type SqlValue = string | number | null;
export interface ArchiveSql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}

export type PulseArchiveDb = HistoryDb;

export const ARCHIVE_STREAMS = [
  "listening",
  "listening-traces",
  "watching",
  "gaming",
  "charging",
  "activity",
  "coding",
  "coding-usage",
  "coding-buckets",
  "limits",
] as const;
export type ArchiveStream = (typeof ARCHIVE_STREAMS)[number];

export type PulseArchiveStreamSnapshot = {
  stream: ArchiveStream;
  revision: number;
  watermark: number;
  rows: string[];
  extra?: string[];
  value?: string | null;
  coding?: Partial<Record<CodingUsageSource, string[]>>;
  replaceRange?: { from: number; to: number };
  replaceToken?: string;
  error?: string;
};

export type PulseArchiveSnapshot = { now: number; streams: PulseArchiveStreamSnapshot[] };

export interface PulseArchiveCoordinator {
  confirmPulseArchive(stream: ArchiveStream, at: number, replaceToken?: string): Promise<number>;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
const SITE_OFFSET_MS = 8 * 60 * 60 * 1000;

export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function siteDayStart(at: number): number {
  return Math.floor((at + SITE_OFFSET_MS) / DAY_MS) * DAY_MS - SITE_OFFSET_MS;
}
export function siteDate(at: number): string {
  return new Date(siteDayStart(at) + SITE_OFFSET_MS).toISOString().slice(0, 10);
}

export function parsedJson<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function revisionOf(value: { revision?: unknown } | null): number {
  return value && Number.isSafeInteger(value.revision) ? value.revision as number : 0;
}
