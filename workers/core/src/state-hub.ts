import { withRequestState } from "@shared/request-state";
import { DurableObject } from "cloudflare:workers";
import { StorageClient } from "@shared/storage-client";
import { SqliteStore } from "@shared/sqlite-store";
import type { StorageCommand, StorageResult } from "@shared/storage-contract";
import { commitPreparedIngest } from "./ingest-handlers";
import { applyEnrichmentPatch } from "./enrichment-patch";
import type { EnrichmentPatch } from "@shared/track-enrichment";
import type { CoreCommand } from "@shared/ingest/prepare";
import { collectIngestEffects, type IngestEffect } from "./ingest-effects";
import { historyArchive, requestStore, type Env } from "./runtime";
import { PulseArchiveState, type ArchiveStream, type PulseArchiveSnapshot } from "./pulse-archive";
import { DEV_OVERRIDE_TTL_MS, overrideIndexStorageKey, overrideStorageKey } from "./dev-overrides";
import { LAG_REPURGE_DELAY_MS, lagStatusTags, queueRepurge, type RepurgeQueue } from "./lag-repurge";
import { purgeStatusTags } from "./live-platform";
import { addPending, planPurge, purgeSlot } from "./purge-throttle";

export type PulseTick = { archive: PulseArchiveSnapshot };

const REPURGE_KEY = "lag-repurge";
const PENDING_PURGE_KEY = "purge-pending";
const PURGE_FLUSHED_KEY = "purge-flushed-at";
const CRON_SLOT_KEY = "cron-slot";

type CommitIngestWire =
  | { ready: true; ok: true; json: string; error: null; effects: IngestEffect[] }
  | { ready: true; ok: false; json: "null"; error: string; effects: IngestEffect[] };

export class StateHub extends DurableObject<Env> {
  private database: SqliteStore;
  private ingestTail: Promise<unknown> = Promise.resolve();
  private pulseArchiveState: PulseArchiveState;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.database = new SqliteStore(ctx.storage.sql, (work) => ctx.storage.transactionSync(work));
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.pulseArchiveState = new PulseArchiveState({
      sql: ctx.storage.sql,
      execute: (commands) => this.database.execute(commands),
    });
  }

  // 读取与提交可见性屏障同一次 RPC 完成。
  async publicRead(commands: StorageCommand[]): Promise<StorageResult[]> {
    if (commands.some((command) => command.op !== "get" && command.op !== "fields" && command.op !== "listRange")) {
      throw new Error("publicRead only accepts read commands");
    }
    await this.ingestTail;
    return this.database.execute(commands) as StorageResult[];
  }

  async updateDevOverride(path: string, envelopeJson: string | null): Promise<string[]> {
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

  commitIngest(command: CoreCommand): Promise<CommitIngestWire> {
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

  // 与上报共用 ingestTail 串行：补写必须排在它所补的那封上报之后，且不能和后来换曲目的那封交错。
  commitEnrichmentPatch(patch: EnrichmentPatch): Promise<{ applied: boolean; effects: IngestEffect[] }> {
    const result = this.ingestTail.then(() => withRequestState(() => requestStore.run({
      env: this.env,
      ctx: this.ctx,
      storage: new StorageClient(async (commands) => this.database.execute(commands)),
    }, async () => {
      try {
        const collected = await collectIngestEffects(() => applyEnrichmentPatch(patch));
        if (!collected.ok) console.warn("[enrichment] patch", patch.target, collected.error);
        return { applied: collected.ok && collected.value, effects: collected.effects };
      } finally {
        await this.ensureAlarm();
      }
    })));
    this.ingestTail = result.catch(() => {});
    return result;
  }

  async pulseTick(): Promise<PulseTick> {
    const idle = { now: Date.now(), streams: [] };
    await this.ingestTail;
    const archive = historyArchive(this.env)
      ? await this.pulseArchiveState.readPulseArchive().catch((error: unknown) => (console.warn("[pulse-archive]", error), idle))
      : idle;
    return { archive };
  }

  // 只进不退：同一格或更早的格（迟到、重投的调用）都认领失败。
  async claimCronSlot(slot: number): Promise<boolean> {
    return this.ctx.storage.transaction(async (txn) => {
      if (((await txn.get<number>(CRON_SLOT_KEY)) ?? -Infinity) >= slot) return false;
      await txn.put(CRON_SLOT_KEY, slot);
      return true;
    });
  }

  async confirmPulseArchive(stream: ArchiveStream, at: number, replaceToken?: string): Promise<number> {
    if (!historyArchive(this.env)) return 0;
    await this.ingestTail;
    return this.pulseArchiveState.confirmPulseArchive(stream, at, replaceToken);
  }

  async deferStatusRepurge(tags: string[]): Promise<void> {
    const lag = lagStatusTags(tags);
    if (!lag.length) return;
    const at = Date.now() + LAG_REPURGE_DELAY_MS;
    await this.ctx.storage.transaction(async (txn) => {
      await txn.put(REPURGE_KEY, queueRepurge((await txn.get<RepurgeQueue>(REPURGE_KEY)) ?? {}, lag, at));
      const current = await txn.getAlarm();
      if (current === null || current > at) await txn.setAlarm(at);
    });
  }

  async requestStatusPurge(tags: readonly string[]): Promise<void> {
    if (!tags.length) return;
    await this.ctx.storage.transaction(async (txn) => {
      await txn.put(PENDING_PURGE_KEY, addPending((await txn.get<string[]>(PENDING_PURGE_KEY)) ?? [], tags));
      const at = purgeSlot((await txn.get<number>(PURGE_FLUSHED_KEY)) ?? 0, Date.now());
      const current = await txn.getAlarm();
      if (current === null || current > at) await txn.setAlarm(at);
    });
  }

  // 认领与记下这一轮的时间在同一个事务里，清除的 RPC 在事务外等；期间进来的失效只会排进下一轮。
  private async flushStatusPurge(): Promise<number | null> {
    const { due, next } = await this.ctx.storage.transaction(async (txn) => {
      const plan = planPurge({
        pending: (await txn.get<string[]>(PENDING_PURGE_KEY)) ?? [],
        lag: (await txn.get<RepurgeQueue>(REPURGE_KEY)) ?? {},
        flushedAt: (await txn.get<number>(PURGE_FLUSHED_KEY)) ?? 0,
      }, Date.now());
      if (plan.due.length) {
        await txn.put(PENDING_PURGE_KEY, plan.state.pending);
        if (Object.keys(plan.state.lag).length) await txn.put(REPURGE_KEY, plan.state.lag);
        else await txn.delete(REPURGE_KEY);
        await txn.put(PURGE_FLUSHED_KEY, plan.state.flushedAt);
      }
      return plan;
    });
    if (!due.length) return next;
    const purged = await withRequestState(() => requestStore.run({ env: this.env, ctx: this.ctx }, () => purgeStatusTags(due)));
    if (purged) return next;
    await this.requestStatusPurge(due);
    return (await this.ctx.storage.getAlarm()) ?? next;
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
    const repurgeAt = await this.flushStatusPurge();
    const housekeepingAt = Date.now() + (removed === 1000 ? 1000 : 60 * 60_000);
    await this.scheduleAlarm(repurgeAt === null ? housekeepingAt : Math.min(repurgeAt, housekeepingAt));
  }
}
