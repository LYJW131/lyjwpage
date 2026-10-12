import { WorkerEntrypoint } from "cloudflare:workers";
import { withRequestState } from "@shared/request-state";
import type { CoreCommand } from "@shared/ingest/prepare";
import type { CommitReply, CoreAudience, CorePower, StateCoreRpc } from "@shared/state-core";
import type { LiveEvent } from "@shared/live-events";
import { getPlaystationPower } from "./playstation-store";
import type { ListeningItem, PlayingContainer, RecentTrack } from "@shared/types";

import { commitRecentlyPlayed, commitRecentTracks } from "./apple-music-recent";
import { dispatchIngestEffects } from "./ingest-effects";
import { enrichCommand, enrichRecentlyPlayed, followUpEnrichment, type EnrichmentFollowUp } from "./listening-enrichment";
import { expireStatusTags, liveRoom } from "./live-platform";
import { lagStatusTags } from "./lag-repurge";
import { issueApiDeveloperToken } from "./musickit-token";
import { requestStore, type Env } from "./runtime";

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
      const { command: enriched, followUp } = await enrichCommand(command);
      const result = await this.hub().commitIngest(enriched).catch((error: unknown) => {
        if (!transientFailure(error)) throw error;
        return error instanceof Error ? error.message : String(error);
      });
      if (typeof result === "string") {
        console.warn("[state-core] commit", command.source, result);
        return { ready: true, ok: false, error: result, retryable: true };
      }
      await dispatchIngestEffects(result.effects);
      if (!result.ok) return { ready: true, ok: false, error: result.error };
      if (followUp) this.ctx.waitUntil(this.followUp(followUp));
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
    const unique = [...new Set(tags)];
    await this.scoped(() => expireStatusTags(unique));
    if (!lagStatusTags(unique).length) return;
    await this.hub().deferStatusRepurge(unique).catch((error: unknown) => {
      console.warn("[revalidate] defer", error instanceof Error ? error.message : String(error));
    });
  }

  private followUp(followUp: EnrichmentFollowUp): Promise<void> {
    return this.scoped(() => followUpEnrichment(followUp, async (patch) => {
      const { effects } = await this.hub().commitEnrichmentPatch(patch);
      await dispatchIngestEffects(effects);
    })).catch((error: unknown) => {
      console.warn("[enrichment] follow-up", followUp.target, followUp.music.title, error instanceof Error ? error.message : String(error));
    });
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
