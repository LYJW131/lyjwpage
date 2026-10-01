import { AsyncLocalStorage } from "node:async_hooks";

import type { LiveEvent } from "@/lib/live-events";
import { pickNowListening } from "@/lib/now-listening";
import type { Liveness } from "@/lib/reporter-liveness";
import type { LocalNowPlaying } from "@/lib/types";
import type { StoredHomePod } from "@shared/homepod-store";
import { candidateFrom, type TrackEnrichment } from "@/lib/track-enrichment";

import { afterResponse, expireStatusTags, publish } from "./live-platform";

export type ListeningEffect = {
  kind: "listening";
  liveness: Liveness;
  activeModules: string[];
  homePod: StoredHomePod | null;
  mac?: {
    music: LocalNowPlaying | null;
    receivedAt: number;
    enrichment: TrackEnrichment | null;
  };
};

export type IngestEffect =
  | { kind: "event"; event: LiveEvent }
  | ListeningEffect
  | { kind: "tags"; tags: string[] };

type EffectCollector = { effects: IngestEffect[] };
const collectors = new AsyncLocalStorage<EffectCollector>();

export type CollectedIngest<T> =
  | { ok: true; value: T; effects: IngestEffect[] }
  | { ok: false; error: string; effects: IngestEffect[] };

export function activeIngestEffectCollector(): EffectCollector | null {
  return collectors.getStore() ?? null;
}

// 晚模块失败不能丢掉此前已落库写入的通知，效果必须随失败结果一起返回。
export async function collectIngestEffects<T>(run: () => Promise<T>): Promise<CollectedIngest<T>> {
  const collector: EffectCollector = { effects: [] };
  return collectors.run(collector, async () => {
    try {
      return { ok: true, value: await run(), effects: collector.effects };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        effects: collector.effects,
      };
    }
  });
}

// 没人在看时推送无人接收，只留首屏失效：它走 Vercel，不经推送房间。
export function effectsForAudience(effects: IngestEffect[], watched: boolean): IngestEffect[] {
  return watched ? effects : effects.filter((effect) => effect.kind === "tags");
}

export function collectSerializableEffects(events: LiveEvent[], tags: readonly string[]): boolean {
  const collector = activeIngestEffectCollector();
  if (!collector) return false;
  collector.effects.push(...events.map((event): IngestEffect => ({ kind: "event", event })));
  const unique = [...new Set(tags)];
  if (unique.length) collector.effects.push({ kind: "tags", tags: unique });
  return true;
}

export function collectListeningEffect(effect: ListeningEffect): boolean {
  const collector = activeIngestEffectCollector();
  if (!collector) return false;
  collector.effects.push(effect);
  return true;
}

function resolveListeningEffect(effect: ListeningEffect): LiveEvent {
  const source = effect.mac;
  const mac = source && effect.activeModules.includes("appleMusic")
    ? candidateFrom(source.music, source.receivedAt, source.enrichment)
    : null;
  const homePod = effect.homePod ? candidateFrom(effect.homePod.music, effect.homePod.receivedAt, effect.homePod.enrichment) : null;
  return {
    type: "listening-now",
    payload: pickNowListening({ mac, homePod, macReceivedAt: source?.receivedAt ?? 0 }, effect.liveness),
  };
}

export async function dispatchIngestEffect(effect: IngestEffect): Promise<void> {
  if (effect.kind === "tags") {
    await expireStatusTags(effect.tags);
    return;
  }
  const event = effect.kind === "event" ? effect.event : resolveListeningEffect(effect);
  await publish(event);
}

export async function dispatchIngestEffects(effects: readonly IngestEffect[]): Promise<void> {
  if (!effects.length) return;
  await afterResponse(async () => {
    const notifications = effects.filter((effect) => effect.kind !== "tags");
    await Promise.all(notifications.map(async (effect) => {
      try {
        await dispatchIngestEffect(effect);
      } catch (error) {
        console.error("[ingest-effect]", error instanceof Error ? error.message : String(error));
      }
    }));
    const tags = effects.flatMap((effect) => effect.kind === "tags" ? effect.tags : []);
    if (tags.length) await expireStatusTags([...new Set(tags)]);
  });
}
