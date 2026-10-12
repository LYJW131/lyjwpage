import type { LiveEvent } from "@shared/live-events";
import { filterStatusTags } from "@shared/status-views";

import { currentContext, requestStore } from "@api/runtime";
import type { LivePushRoom } from "./origin-worker";
import type { Env } from "./runtime";


export function afterResponse(work: () => Promise<void>): Promise<void> {
  const store = requestStore.getStore();
  if (!store) return work();
  store.ctx.waitUntil(work());
  return Promise.resolve();
}

const REVALIDATE_TIMEOUT_MS = 5_000;

export async function expireStatusTags(tags: readonly string[]): Promise<void> {
  const valid = filterStatusTags(tags);
  if (!valid.length) return;
  const service = currentContext().env.SITE_CACHE;
  if (!service) {
    console.warn("[revalidate] SITE_CACHE is not configured");
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      service.invalidate(valid),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Site cache timeout")), REVALIDATE_TIMEOUT_MS);
      }),
    ]);
    console.log("[revalidate]", valid.join(","));
  } catch (error) {
    console.error("[revalidate]", error instanceof Error ? error.message : String(error));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ROOM_ID = "global-apac";

// locationHint 只在对象首次创建时生效，已存在的对象不会搬家；要换位置只能换 ROOM_ID。
export function liveRoom(env: Env): DurableObjectStub<LivePushRoom> {
  return env.LIVE_PUSH.get(env.LIVE_PUSH.idFromName(ROOM_ID), { locationHint: "apac" });
}

export async function publish(event: LiveEvent): Promise<void> {
  try {
    const { env } = currentContext();
    await liveRoom(env).broadcast(JSON.stringify(event));
  } catch (error) {
    console.error("[live]", event.type, error instanceof Error ? error.message : String(error));
  }
}
