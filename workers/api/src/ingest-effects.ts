import { AsyncLocalStorage } from "node:async_hooks";

import type { LiveEvent } from "@/lib/live-events";
import { pickNowListening } from "@/lib/now-listening";
import type { PlayingQueueTrack } from "@/lib/playing-queue";
import type { Liveness } from "@/lib/reporter-liveness";
import type { LocalNowPlaying } from "@/lib/types";
import type { StoredHomePod } from "@shared/homepod-store";
import { decorateCandidate } from "@shared/telemetry";

import { afterResponse, expireStatusTags, publish } from "./live-platform";

export type ListeningEffect = {
  kind: "listening";
  liveness: Liveness;
  activeModules: string[];
  homePod: StoredHomePod | null;
  mac?: {
    music: LocalNowPlaying | null;
    receivedAt: number;
    upcomingTracks: PlayingQueueTrack[];
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

/**
 * StateHub 用这层收集提交结果。handler 即使在较晚模块抛错，已经确认落库的写及
 * 它们对应的通知也会跟错误一起返回普通 Worker。
 */
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

async function resolveListeningEffect(effect: ListeningEffect): Promise<LiveEvent> {
  const source = effect.mac;
  const [mac, homePod] = await Promise.all([
    source && effect.activeModules.includes("appleMusic")
      ? decorateCandidate(source.music, source.receivedAt, source.upcomingTracks)
      : null,
    effect.homePod
      ? decorateCandidate(effect.homePod.music, effect.homePod.receivedAt)
      : null,
  ]);
  return {
    type: "listening-now",
    payload: pickNowListening({
      mac,
      homePod,
      macReceivedAt: source?.receivedAt ?? 0,
    }, effect.liveness),
  };
}

export async function dispatchIngestEffect(effect: IngestEffect): Promise<void> {
  if (effect.kind === "tags") {
    await expireStatusTags(effect.tags);
    return;
  }
  const event = effect.kind === "event" ? effect.event : await resolveListeningEffect(effect);
  await publish(event);
}

/** 提交完成后由普通 Worker 调用；网络请求不再占 StateHub 的执行时间。 */
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
