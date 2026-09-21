import { withRequestState } from "@shared/request-state";
import { DurableObject } from "cloudflare:workers";
import { StorageClient } from "@shared/storage-client";
import { SqliteStore, type StoredEntry } from "@shared/sqlite-store";
import type { StorageCommand, StorageResult } from "@shared/storage-contract";
import { commitPreparedIngest, type PreparedIngest } from "./ingest-handlers";
import { collectIngestEffects, type IngestEffect } from "./ingest-effects";
import { historyArchiveEnabled, pulseScoringEnabled, readModelEnabled, requestStore, type Env } from "./runtime";
import { PulseArchiveState, type PulseArchiveSnapshot } from "./pulse-archive";
import { PulseScoreState, type PulseScoreClaim } from "./pulse-score-state";
import type { PulseAssessment } from "@shared/pulse-assessment";
import type { PulseDomain } from "@/lib/types";
import { READ_MODEL_PATHS, readModelPathsForSource } from "./read-model";
import { ReadModelPublisher } from "./read-model-publisher";
import { DEV_OVERRIDE_TTL_MS, overrideIndexStorageKey, overrideStorageKey } from "./dev-overrides";

type CommitIngestWire =
  | { ready: false; ok: false; json: "null"; error: null; effects: [] }
  | { ready: true; ok: true; json: string; error: null; effects: IngestEffect[] }
  | { ready: true; ok: false; json: "null"; error: string; effects: IngestEffect[] };

/** Authoritative state and existing ingest coordination; public KV is a projection. */
export class StateHub extends DurableObject<Env> {
  private database: SqliteStore;
  private ingestTail: Promise<unknown> = Promise.resolve();
  private readModels: ReadModelPublisher | null;
  private pulseArchiveState: PulseArchiveState;
  private pulseScoreState: PulseScoreState;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.database = new SqliteStore(ctx.storage.sql, (work) => ctx.storage.transactionSync(work));
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    ctx.storage.sql.exec("DROP TABLE IF EXISTS esa_purge");
    this.readModels = readModelEnabled(env) && env.READ_MODEL ? new ReadModelPublisher({
      sql: ctx.storage.sql,
      kv: env.READ_MODEL,
      prefix: env.STORAGE_PREFIX ?? "lyjwpage",
      render: (path) => {
        if (!this.env.READ_MODEL_RENDERER) throw new Error("READ_MODEL_RENDERER is not configured");
        return this.env.READ_MODEL_RENDERER.render(path);
      },
    }) : null;
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
    await this.queueReadModels();
  }

  async publicBarrier(): Promise<boolean> {
    if (!this.ready()) return false;
    await this.ingestTail;
    return this.ready();
  }

  /** One strongly-consistent read batch; callers establish request visibility via publicBarrier first. */
  publicRead(commands: StorageCommand[]): StorageResult[] {
    if (!this.ready()) throw new Error("State storage is not initialized");
    if (commands.some((command) => command.op !== "get" && command.op !== "fields" && command.op !== "listRange")) {
      throw new Error("publicRead only accepts read commands");
    }
    return this.database.execute(commands) as StorageResult[];
  }

  /** Atomically mutate one fixture and its index; concurrent local PUT/DELETE cannot lose paths. */
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
    if (commands.some((command) => command.op !== "get" && command.op !== "fields" && command.op !== "listRange")) {
      await this.ensureAlarm();
    }
    return result;
  }

  commitIngest(command: PreparedIngest): Promise<CommitIngestWire> {
    if (!this.ready()) return Promise.resolve({ ready: false, ok: false, json: "null", error: null, effects: [] });
    const source = command.source;
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
        // A handler can commit liveness before rejecting a later module. Rebuild
        // from authority even then; never put KV or render public APIs in this queue.
        this.readModels?.enqueue(readModelPathsForSource(source));
        await this.ensureAlarm();
      }
    })));
    this.ingestTail = result.catch(() => {});
    return result;
  }

  async queueReadModels(paths: string[] = [...READ_MODEL_PATHS]): Promise<void> {
    if (!this.readModels || !this.ready()) return;
    this.readModels.enqueue(paths);
    await this.ensureAlarm();
  }

  async readPulseArchive(): Promise<PulseArchiveSnapshot> {
    if (!this.ready() || !historyArchiveEnabled(this.env)) return { domains: [] };
    await this.ingestTail;
    return this.pulseArchiveState.readPulseArchive();
  }

  async confirmPulseArchive(domain: PulseDomain, at: number): Promise<number> {
    if (!this.ready() || !historyArchiveEnabled(this.env)) return 0;
    await this.ingestTail;
    return this.pulseArchiveState.confirmPulseArchive(domain, at);
  }

  async claimPulseScore(): Promise<PulseScoreClaim | null> {
    if (!this.ready() || !pulseScoringEnabled(this.env)) return null;
    await this.ingestTail;
    return this.pulseScoreState.claimPulseScore();
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
    return this.scheduleAlarm(Math.max(Date.now() + 1, Math.min(
      Date.now() + 60 * 60_000, this.readModels?.nextAlarm() ?? Infinity,
    )));
  }
  async alarm(): Promise<void> {
    const removed = this.database.purgeExpired();
    await this.readModels?.flush();
    await this.scheduleAlarm(Math.max(Date.now() + 1, Math.min(
      Date.now() + (removed === 1000 ? 1000 : 60 * 60_000),
      this.readModels?.nextAlarm() ?? Infinity,
    )));
  }
}
