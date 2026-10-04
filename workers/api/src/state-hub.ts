import { withRequestState } from "@shared/request-state";
import { DurableObject } from "cloudflare:workers";
import { StorageClient } from "@shared/storage-client";
import { SqliteStore, type StoredEntry } from "@shared/sqlite-store";
import type { StorageCommand, StorageResult } from "@shared/storage-contract";
import { commitPreparedIngest } from "./ingest-handlers";
import type { CoreCommand } from "@shared/ingest/prepare";
import { collectIngestEffects, type IngestEffect } from "./ingest-effects";
import { historyArchiveEnabled, pulseScoringEnabled, requestStore, type Env } from "./runtime";
import { PulseArchiveState, type ArchiveStream, type PulseArchiveSnapshot } from "./pulse-archive";
import { PulseScoreState, type PulseScoreClaim } from "./pulse-score-state";
import type { PulseAssessment } from "@shared/pulse-assessment";
import { DEV_OVERRIDE_TTL_MS, overrideIndexStorageKey, overrideStorageKey } from "./dev-overrides";

const READ_OPS: ReadonlySet<StorageCommand["op"]> = new Set(["get", "fields", "listRange", "listSince"]);

export type PulseTick = { archive: PulseArchiveSnapshot; score: PulseScoreClaim | null };

type CommitIngestWire =
  | { ready: false; ok: false; json: "null"; error: null; effects: [] }
  | { ready: true; ok: true; json: string; error: null; effects: IngestEffect[] }
  | { ready: true; ok: false; json: "null"; error: string; effects: IngestEffect[] };

export class StateHub extends DurableObject<Env> {
  private database: SqliteStore;
  private ingestTail: Promise<unknown> = Promise.resolve();
  private pulseArchiveState: PulseArchiveState;
  private pulseScoreState: PulseScoreState;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.database = new SqliteStore(ctx.storage.sql, (work) => ctx.storage.transactionSync(work));
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    ctx.storage.sql.exec("DROP TABLE IF EXISTS esa_purge");
    ctx.storage.sql.exec("DROP TABLE IF EXISTS public_read_model_jobs");
    ctx.storage.sql.exec("DELETE FROM metadata WHERE key = 'lag_mirrors'");
    ctx.storage.sql.exec("DELETE FROM entries WHERE key LIKE '%:lag-mirror:pending:%'");
    this.pulseArchiveState = new PulseArchiveState({
      sql: ctx.storage.sql,
      execute: (commands) => this.database.execute(commands),
    });
    this.pulseScoreState = new PulseScoreState({
      sql: ctx.storage.sql,
      execute: (commands) => this.database.execute(commands),
    });
  }

  ready(): boolean {
    return this.ctx.storage.sql.exec("SELECT value FROM metadata WHERE key = 'initialized'").toArray()[0]?.value === "1";
  }
  async finishImport(): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO metadata(key, value) VALUES ('initialized', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
  }

  // 读取与初始化、提交可见性屏障同一次 RPC 完成；null 表示存储尚未初始化。
  async publicRead(commands: StorageCommand[]): Promise<StorageResult[] | null> {
    if (commands.some((command) => !READ_OPS.has(command.op))) {
      throw new Error("publicRead only accepts read commands");
    }
    if (!this.ready()) return null;
    await this.ingestTail;
    if (!this.ready()) return null;
    return this.database.execute(commands) as StorageResult[];
  }

  async updateDevOverride(path: string, envelopeJson: string | null): Promise<string[]> {
    if (!this.ready()) throw new Error("State storage is not initialized");
    if (!path.startsWith("/api/") || path.length > 1024) throw new Error("Invalid override path");
    if (envelopeJson !== null) {
      const value: unknown = JSON.parse(envelopeJson);
      if (!value || typeof value !== "object" || typeof (value as { ok?: unknown }).ok !== "boolean") {
        throw new Error("Invalid override envelope");
      }
    }
    const prefix = this.env.STORAGE_PREFIX ?? "lyjwpage";
    const indexKey = overrideIndexStorageKey(prefix);
    const valueKey = overrideStorageKey(prefix, path);
    const paths = this.database.updateIndexedString(indexKey, path, valueKey, envelopeJson, DEV_OVERRIDE_TTL_MS);
    await this.ensureAlarm();
    return paths;
  }

  async execute(commands: StorageCommand[]): Promise<unknown[]> {
    const result = this.database.execute(commands);
    if (commands.some((command) => !READ_OPS.has(command.op))) {
      await this.ensureAlarm();
    }
    return result;
  }

  commitIngest(command: CoreCommand): Promise<CommitIngestWire> {
    if (!this.ready()) return Promise.resolve({ ready: false, ok: false, json: "null", error: null, effects: [] });
    const result = this.ingestTail.then(() => withRequestState(() => requestStore.run({
      env: this.env,
      ctx: this.ctx,
      storage: new StorageClient(async (commands) => this.database.execute(commands)),
    }, async () => {
      try {
        const collected = await collectIngestEffects(() => commitPreparedIngest(command));
        const wire: CommitIngestWire = collected.ok
          ? { ready: true, ok: true, json: JSON.stringify(collected.value), error: null, effects: collected.effects }
          : { ready: true, ok: false, json: "null", error: collected.error, effects: collected.effects };
        return wire;
      } finally {
        await this.ensureAlarm();
      }
    })));
    this.ingestTail = result.catch(() => {});
    return result;
  }

  // 归档与评分各自失败不连累对方，所以分开兜底，各回各的空值。
  async pulseTick(): Promise<PulseTick> {
    const idle: PulseTick = { archive: { now: Date.now(), streams: [] }, score: null };
    if (!this.ready()) return idle;
    await this.ingestTail;
    const archive = historyArchiveEnabled(this.env)
      ? await this.pulseArchiveState.readPulseArchive().catch((error: unknown) => (console.warn("[pulse-archive]", error), idle.archive))
      : idle.archive;
    const score = pulseScoringEnabled(this.env)
      ? await this.pulseScoreState.claimPulseScore().catch((error: unknown) => (console.warn("[pulse-score]", error), null))
      : null;
    return { archive, score };
  }

  async confirmPulseArchive(stream: ArchiveStream, at: number, replaceToken?: string): Promise<number> {
    if (!this.ready() || !historyArchiveEnabled(this.env)) return 0;
    await this.ingestTail;
    return this.pulseArchiveState.confirmPulseArchive(stream, at, replaceToken);
  }

  async activatePulseScore(token: string, generation: number): Promise<boolean> {
    if (!this.ready() || !pulseScoringEnabled(this.env)) return false;
    await this.ingestTail;
    return this.pulseScoreState.activatePulseScore(token, generation);
  }

  async finishPulseScore(token: string, generation: number, records: PulseAssessment[]): Promise<boolean> {
    if (!this.ready() || !pulseScoringEnabled(this.env)) return false;
    await this.ingestTail;
    return this.pulseScoreState.finishPulseScore(token, generation, records);
  }

  async importMissing(entries: StoredEntry[]): Promise<number> {
    const count = this.database.importMissing(entries);
    await this.ensureAlarm();
    return count;
  }
  private async scheduleAlarm(at: number): Promise<void> {
    await this.ctx.storage.transaction(async (txn) => {
      const current = await txn.getAlarm();
      if (current === null || current > at) await txn.setAlarm(at);
    });
  }
  private ensureAlarm(): Promise<void> {
    return this.scheduleAlarm(Date.now() + 60 * 60_000);
  }
  async alarm(): Promise<void> {
    const removed = this.database.purgeExpired();
    await this.scheduleAlarm(Date.now() + (removed === 1000 ? 1000 : 60 * 60_000));
  }
}
