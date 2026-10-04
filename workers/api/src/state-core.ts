import { WorkerEntrypoint } from "cloudflare:workers";
import { withRequestState } from "@shared/request-state";
import type { CoreCommand } from "@shared/ingest/prepare";
import type { CommitReply, CoreAudience, CorePower, StateCoreRpc } from "@shared/state-core";
import type { LiveEvent } from "@/lib/live-events";
import { getPlaystationPower } from "@/lib/playstation-store";
import type { ListeningItem, PlayingContainer, RecentTrack } from "@/lib/types";

import { commitRecentlyPlayed, commitRecentTracks } from "./apple-music-recent";
import { dispatchIngestEffects } from "./ingest-effects";
import { enrichCommand, enrichRecentlyPlayed } from "./listening-enrichment";
import { expireStatusTags, liveRoom } from "./live-platform";
import { issueApiDeveloperToken } from "./musickit-token";
import { requestStore, type Env } from "./runtime";

function transientFailure(error: unknown): boolean {
  const flags = error as { retryable?: unknown; overloaded?: unknown } | null;
  return flags?.retryable === true || flags?.overloaded === true;
}

export class StateCore extends WorkerEntrypoint<Env> implements StateCoreRpc {
  async ready(): Promise<boolean> {
    return this.hub().ready();
  }

  // 必须先派发效果再处理提交失败：较早模块已落库的变化仍需通知。
  async commitIngest(command: CoreCommand): Promise<CommitReply> {
    return this.scoped(async () => {
      // DO 重置、过载抛的错带 retryable / overloaded；这些属性过不了上报入口那条 Service Binding，在这里转成回执。
      const result = await this.hub().commitIngest(await enrichCommand(command)).catch((error: unknown) => {
        if (!transientFailure(error)) throw error;
        return error instanceof Error ? error.message : String(error);
      });
      if (typeof result === "string") {
        console.warn("[state-core] commit", command.source, result);
        return { ready: true, ok: false, error: result, retryable: true };
      }
      await dispatchIngestEffects(result.effects);
      if (!result.ready) return { ready: false, ok: false };
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
    const issued = await issueApiDeveloperToken(this.env);
    return { token: issued.token, expiresAt: issued.expiresAt * 1000 };
  }

  async commitRecentlyPlayed(items: ListeningItem[], container?: PlayingContainer | null): Promise<{ changed: boolean }> {
    return this.scoped(async () => commitRecentlyPlayed(await enrichRecentlyPlayed(items), container));
  }

  async commitRecentTracks(tracks: RecentTrack[], observedAt?: number): Promise<{ traced: boolean; nextBy?: number }> {
    return this.scoped(() => commitRecentTracks(tracks, observedAt));
  }

  async revalidate(tags: string[]): Promise<void> {
    await this.scoped(() => expireStatusTags([...new Set(tags)]));
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
