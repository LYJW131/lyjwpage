import { journalKey, JOURNAL_SUBJECTS, parseJournalEntry, type JournalEntry, type JournalSubject } from "@shared/state-journal";
import type { StorageClient } from "@shared/storage-client";

import type { ArchiveSql, PulseArchiveDb } from "./pulse-archive";

const INSERT = "INSERT OR IGNORE INTO state_changes(subject, t, at, state) VALUES (?, ?, ?, ?)";
const CHUNK_SIZE = 100;
const WATERMARK_PREFIX = "state-journal:";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把 StateHub 的状态变更镜像进 D1。
 *
 * 和 pulse 归档同一套规矩：cron 每分钟驱动，不挂在上报的成功与否上（上报当时
 * 已经把热数据写进 StateHub）。水位线是已归档的最大 `t`，只有 batch 落地后才
 * 前进；失败留在原处，下一分钟整段重试。`INSERT OR IGNORE` 让重放无害。
 */
export class StateJournalArchive {
  private sql: ArchiveSql;
  private db: PulseArchiveDb;
  private storage: StorageClient;
  private chunkSize: number;
  private log: (subject: string, error: unknown) => void;
  private running = false;

  constructor(options: {
    sql: ArchiveSql;
    db: PulseArchiveDb;
    storage: StorageClient;
    chunkSize?: number;
    log?: (subject: string, error: unknown) => void;
  }) {
    this.sql = options.sql;
    this.db = options.db;
    this.storage = options.storage;
    this.chunkSize = options.chunkSize ?? CHUNK_SIZE;
    this.log = options.log ?? ((subject, error) => console.warn("[state-journal]", subject, reason(error)));
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const subject of JOURNAL_SUBJECTS) {
        try {
          await this.archiveSubject(subject);
        } catch (error) {
          this.log(subject, error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private watermark(subject: JournalSubject): number {
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", WATERMARK_PREFIX + subject).toArray()[0];
    const at = Number(row?.value);
    return Number.isFinite(at) ? at : 0;
  }

  private advance(subject: JournalSubject, t: number): void {
    this.sql.exec(
      "INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      WATERMARK_PREFIX + subject,
      String(t),
    );
  }

  private async pending(subject: JournalSubject): Promise<JournalEntry[]> {
    const watermark = this.watermark(subject);
    const rows = await this.storage.listRange(journalKey(subject), 0, -1);
    const entries: JournalEntry[] = [];
    for (const raw of rows) {
      const entry = parseJournalEntry(raw);
      if (entry && entry.t > watermark) entries.push(entry);
    }
    return entries.sort((a, b) => a.t - b.t);
  }

  private async archiveSubject(subject: JournalSubject): Promise<void> {
    const entries = await this.pending(subject);
    if (!entries.length) return;
    for (let at = 0; at < entries.length; at += this.chunkSize) {
      const chunk = entries.slice(at, at + this.chunkSize);
      await this.db.batch(chunk.map((entry) => this.db.prepare(INSERT).bind(
        subject,
        entry.t,
        entry.at,
        JSON.stringify(entry.state ?? null),
      )));
      this.advance(subject, chunk[chunk.length - 1].t);
    }
  }
}
