import type { LiveEvent } from "@/lib/live-events";

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

export async function expireStatusTags(
  tags: readonly string[],
): Promise<void> {
  if (!tags.length) return;
  const delivered = await revalidateVercel(currentContext().env, tags);
  if (delivered) console.log("[revalidate]", tags.join(","));
}

async function revalidateVercel(env: Env, tags: readonly string[]): Promise<boolean> {
  const site = env.SITE_URL?.replace(/\/+$/, "");
  const secret = env.REVALIDATE_SECRET;
  if (!site || !secret) {
    console.warn("[revalidate] 没配 SITE_URL / REVALIDATE_SECRET，缓存失效停用");
    return false;
  }

  try {
    const response = await fetch(`${site}/api/revalidate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const envelope = (await response.json().catch(() => null)) as { error?: string } | null;
      console.error("[revalidate]", site, response.status, envelope?.error ?? "");
      return false;
    }
    return true;
  } catch (error) {
    console.error("[revalidate]", error instanceof Error ? error.message : String(error));
    return false;
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
