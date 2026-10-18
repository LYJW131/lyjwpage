import { WorkerEntrypoint } from "cloudflare:workers";
import { AwaitingReport } from "@shared/awaiting-report";
import { HEARTBEAT_SERIES, recordCheck } from "@shared/health";
import { withRequestState } from "@shared/request-state";
import type { CoreCommand } from "@shared/ingest/prepare";
import type { CommitReply, CoreAudience, CorePower, StateCoreRpc } from "@shared/state-core";
import type { LiveEvent } from "@shared/live-events";
import { getPlaystationPower } from "./playstation-store";
import type { ListeningItem, PlayingContainer, RecentTrack } from "@shared/types";
import type { EnrichmentPatch } from "@shared/track-enrichment";

import { commitRecentlyPlayed, commitRecentTracks } from "./apple-music-recent";
import { watchClockLayout } from "./clock-layout-watch";
import { cronRoundDue } from "./cron-heartbeat";
import { runCronRound } from "./cron-round";
import { dispatchIngestEffects } from "./ingest-effects";
import { expireStatusTags, liveRoom } from "./live-platform";
import { lagStatusTags } from "./lag-repurge";
import { previewWorkerEnabled } from "./preview";
import { historyArchive, requestStore, type Env } from "./runtime";
import { voronoiCardRound } from "./voronoi-card";

function transientFailure(error: unknown): boolean {
  const flags = error as { retryable?: unknown; overloaded?: unknown } | null;
  return flags?.retryable === true || flags?.overloaded === true;
}

export class StateCore extends WorkerEntrypoint<Env> implements StateCoreRpc {
  async ready(): Promise<boolean> {
    return true;
  }

  // 必须先派发效果再处理提交失败：较早模块已落库的变化仍需通知。
  async commitIngest(command: CoreCommand): Promise<CommitReply> {
    return this.scoped(async () => {
      // DO 重置、过载抛的错带 retryable / overloaded；这些属性过不了上报入口那条 Service Binding，在这里转成回执。
      const result = await this.hub().commitIngest(command).catch((error: unknown) => {
        if (!transientFailure(error)) throw error;
        return error instanceof Error ? error.message : String(error);
      });
      if (typeof result === "string") {
        console.warn("[state-core] commit", command.source, result);
        return { ready: true, ok: false, error: result, retryable: true };
      }
      await dispatchIngestEffects(result.effects);
      if (!result.ok) return { ready: true, ok: false, error: result.error };
      return { ready: true, ok: true, data: JSON.parse(result.json) as unknown };
    });
  }

  async broadcastVersion(): Promise<number> {
    return this.room().broadcast(JSON.stringify({ type: "version", payload: null } satisfies LiveEvent));
  }

  async audience(): Promise<CoreAudience> {
    return this.room().audience();
  }

  async playstationPower(): Promise<CorePower> {
    return this.scoped(async () => {
      const power = await getPlaystationPower();
      return power ? { on: power.on, observedAt: power.observedAt } : null;
    });
  }

  async appleDeveloperToken(): Promise<{ token: string; expiresAt: number }> {
    throw new Error("core 不持有 Apple 私钥：developer token 由采集 Worker 自己签");
  }

  async commitRecentlyPlayed(items: ListeningItem[], container?: PlayingContainer | null): Promise<{ changed: boolean }> {
    return this.scoped(() => commitRecentlyPlayed(items, container));
  }

  async commitRecentTracks(tracks: RecentTrack[], observedAt?: number): Promise<{ traced: boolean; nextBy?: number }> {
    return this.scoped(() => commitRecentTracks(tracks, observedAt));
  }

  async commitEnrichmentPatch(patch: EnrichmentPatch): Promise<{ applied: boolean }> {
    return this.scoped(() => this.applyPatch(patch));
  }

  async revalidate(tags: string[]): Promise<void> {
    const unique = [...new Set(tags)];
    await this.scoped(() => expireStatusTags(unique));
    if (!lagStatusTags(unique).length) return;
    await this.hub().deferStatusRepurge(unique).catch((error: unknown) => {
      console.warn("[revalidate] defer", error instanceof Error ? error.message : String(error));
    });
  }

  // Preview 仍可能连着共享归档，必须独立禁止这一轮写入。
  async cronRound(scheduledTime: number): Promise<{ ran: boolean }> {
    if (previewWorkerEnabled()) return { ran: false };
    await this.scoped(() => watchClockLayout()).catch((error: unknown) => {
      console.warn("[clock-layout]", error instanceof Error ? error.message : String(error));
    });
    if (!cronRoundDue(scheduledTime)) return { ran: false };
    let ok = false;
    try {
      await runCronRound(this.env, scheduledTime);
      ok = true;
    } finally {
      const db = historyArchive(this.env);
      if (db) {
        await recordCheck(db, HEARTBEAT_SERIES, scheduledTime, ok)
          .catch((error: unknown) => console.error("[cron-heartbeat]", error));
      }
    }
    await this.scoped(() => voronoiCardRound()).catch((error: unknown) => {
      if (error instanceof AwaitingReport) console.warn("[voronoi-card]", error.message);
      else console.error("[voronoi-card]", error);
    });
    return { ran: true };
  }

  private async applyPatch(patch: EnrichmentPatch): Promise<{ applied: boolean }> {
    const { applied, effects } = await this.hub().commitEnrichmentPatch(patch);
    await dispatchIngestEffects(effects);
    return { applied };
  }

  private hub() {
    return this.env.STATE.get(this.env.STATE.idFromName("global"));
  }

  private room() {
    return liveRoom(this.env);
  }

  private scoped<T>(run: () => Promise<T>): Promise<T> {
    return withRequestState(() => requestStore.run({ env: this.env, ctx: this.ctx }, run));
  }
}
