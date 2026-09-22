import { JOURNAL_LIMIT, JOURNAL_SUBJECTS, journalKey, parseJournalEntry, type JournalEntry, type JournalSubject } from "@shared/state-journal";
import type { StorageCommand } from "@shared/storage-contract";

import type { ArchiveSql, PulseArchiveDb } from "./pulse-archive";

const INSERT = "INSERT OR IGNORE INTO state_changes(subject, t, at, state) VALUES (?, ?, ?, ?)";
const CHUNK_SIZE = 100;
const WATERMARK_PREFIX = "state-journal:";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type StateJournalSubjectSnapshot = {
  subject: JournalSubject;
  watermark: number;
  /** Raw authoritative rows; parsing and sorting are Worker work. */
  rows: string[];
  /** A broken subject remains isolated inside the single coordinator RPC. */
  error?: string;
};

export type StateJournalSnapshot = { subjects: StateJournalSubjectSnapshot[] };

/** RPC shape implemented by StateHub and consumed by the ordinary Worker executor. */
export interface StateJournalCoordinator {
  readStateJournal(): Promise<StateJournalSnapshot>;
  confirmStateJournal(subject: JournalSubject, t: number): Promise<number>;
}

/**
 * Durable state half of the display-state journal. It exposes one bounded
 * snapshot RPC and monotonic acknowledgements; it never talks to D1.
 */
export class StateJournalArchiveState implements StateJournalCoordinator {
  private sql: ArchiveSql;
  private execute: (commands: StorageCommand[]) => unknown[];

  constructor(options: {
    sql: ArchiveSql;
    execute: (commands: StorageCommand[]) => unknown[];
  }) {
    this.sql = options.sql;
    this.execute = options.execute;
  }

  async readStateJournal(): Promise<StateJournalSnapshot> {
    const subjects: StateJournalSubjectSnapshot[] = [];
    for (const subject of JOURNAL_SUBJECTS) {
      try {
        const rows = this.execute([{
          op: "listRange",
          key: journalKey(subject),
          start: 0,
          stop: JOURNAL_LIMIT - 1,
        }])[0] as string[];
        subjects.push({ subject, watermark: this.watermark(subject), rows });
      } catch (error) {
        subjects.push({ subject, watermark: 0, rows: [], error: reason(error) });
      }
    }
    return { subjects };
  }

  async confirmStateJournal(subject: JournalSubject, t: number): Promise<number> {
    if (!(JOURNAL_SUBJECTS as readonly string[]).includes(subject) || !Number.isSafeInteger(t) || t < 0) {
      throw new Error("Invalid state journal confirmation");
    }
    this.sql.exec(
      `INSERT INTO metadata(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CASE
         WHEN CAST(excluded.value AS INTEGER) > CAST(metadata.value AS INTEGER) THEN excluded.value
         ELSE metadata.value
       END`,
      WATERMARK_PREFIX + subject,
      String(t),
    );
    return this.watermark(subject);
  }

  private watermark(subject: JournalSubject): number {
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", WATERMARK_PREFIX + subject).toArray()[0];
    const at = Number(row?.value);
    return Number.isFinite(at) ? at : 0;
  }
}

/**
 * Ordinary Worker half of the display-state journal.
 *
 * Cron drives this once a minute. Ingest has already appended the hot row to
 * StateHub; this only mirrors it. The watermark is the largest archived `t`.
 * It advances only after `INSERT OR IGNORE` lands, and only forward, so a
 * failed or older chunk is replayed next minute. One subject failing does not
 * block the others.
 */
export class StateJournalArchive {
  private coordinator: StateJournalCoordinator;
  private db: PulseArchiveDb;
  private chunkSize: number;
  private log: (subject: string, error: unknown) => void;

  constructor(options: {
    coordinator: StateJournalCoordinator;
    db: PulseArchiveDb;
    chunkSize?: number;
    log?: (subject: string, error: unknown) => void;
  }) {
    this.coordinator = options.coordinator;
    this.db = options.db;
    this.chunkSize = options.chunkSize ?? CHUNK_SIZE;
    this.log = options.log ?? ((subject, error) => console.warn("[state-journal]", subject, reason(error)));
  }

  async run(): Promise<void> {
    const snapshot = await this.coordinator.readStateJournal();
    for (const subject of snapshot.subjects) {
      try {
        await this.archiveSubject(subject);
      } catch (error) {
        this.log(subject.subject, error);
      }
    }
  }

  private async archiveSubject(snapshot: StateJournalSubjectSnapshot): Promise<void> {
    if (snapshot.error) throw new Error(snapshot.error);
    const entries: JournalEntry[] = [];
    for (const raw of snapshot.rows) {
      const entry = parseJournalEntry(raw);
      if (entry && entry.t > snapshot.watermark) entries.push(entry);
    }
    entries.sort((a, b) => a.t - b.t);
    if (!entries.length) return;

    for (let at = 0; at < entries.length; at += this.chunkSize) {
      const chunk = entries.slice(at, at + this.chunkSize);
      await this.db.batch(chunk.map((entry) => this.db.prepare(INSERT).bind(
        snapshot.subject,
        entry.t,
        entry.at,
        JSON.stringify(entry.state ?? null),
      )));
      await this.coordinator.confirmStateJournal(snapshot.subject, chunk[chunk.length - 1].t);
    }
  }
}
