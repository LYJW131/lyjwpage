import type { LiveEvent } from "@/lib/live-events";
import {
  activeIngestEffectCollector,
  collectListeningEffect,
  collectSerializableEffects,
  dispatchIngestEffect,
  type ListeningEffect,
} from "./ingest-effects";
import { afterResponse, expireStatusTags, publish } from "./live-platform";
export type PendingEvent = LiveEvent | null | Promise<LiveEvent | null>;
export type Fanout = {
  writes?: ReadonlyArray<Promise<unknown>>;
  events?: ReadonlyArray<PendingEvent>;
  notify?: ReadonlyArray<PendingEvent>;
  listening?: ReadonlyArray<ListeningEffect | Promise<ListeningEffect>>;
  tags?: readonly string[];
};
async function publishPending(pending: PendingEvent): Promise<void> {
  try { const event = await pending; if (event) await publish(event); }
  catch (error) { console.error("[live]", error); }
}
/** 确认落库后才响应成功；广播与首屏 stale 通知在后台完成。 */
export async function fanout({ writes = [], events = [], notify = [], listening = [], tags = [] }: Fanout): Promise<void> {
  await Promise.all(writes);
  if (activeIngestEffectCollector()) {
    const [eventResults, listeningResults] = await Promise.all([
      Promise.allSettled([...events, ...notify]),
      Promise.allSettled(listening),
    ]);
    const ready: LiveEvent[] = [];
    for (const result of eventResults) {
      if (result.status === "fulfilled") {
        if (result.value) ready.push(result.value);
      } else {
        console.error("[live]", result.reason);
      }
    }
    collectSerializableEffects(
      ready,
      tags,
    );
    for (const result of listeningResults) {
      if (result.status === "fulfilled") collectListeningEffect(result.value);
      else console.error("[live]", result.reason);
    }
    return;
  }
  await afterResponse(async () => {
    await Promise.all([
      ...[...events, ...notify].map(publishPending),
      ...listening.map(async (pending) => {
        try { await dispatchIngestEffect(await pending); }
        catch (error) { console.error("[live]", error); }
      }),
    ]);
    if (tags.length) await expireStatusTags([...new Set(tags)]);
  });
}
