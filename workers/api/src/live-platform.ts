import { statusEnvelope } from "@/lib/api";
import { vibeCodingLayoutKey } from "@/lib/home-layout";
import { VIBECODING_TAG, type LiveEvent } from "@/lib/live-events";
import { mirrorKey } from "@/lib/storage";
import { getVibeCodingSnapshot } from "@/lib/vibecoding";

import { currentContext, requestStore } from "@api/runtime";
import type { Env } from "./runtime";

/** Worker 后台任务、缓存失效通知和房间广播。 */

export function afterResponse(work: () => Promise<void>): Promise<void> {
  const store = requestStore.getStore();
  if (!store) return work();
  store.ctx.waitUntil(work());
  return Promise.resolve();
}

const REVALIDATE_TIMEOUT_MS = 5_000;

/**
 * 首屏布局变了才通知 Vercel 标签失效，已有 HTML 先返回、后台重建。
 *
 * 发不发由各个上报在自己手里的新旧两份上判断（见 lib/home-layout）；内容变化
 * 不来这里，交给首屏快照 `revalidate: 600` 的定时重建。只有 vibe coding 在这里
 * 再筛一遍：它的骨架由用量、限额、Cursor 三路拼出来，哪一路进来都看不全，
 * 所以按拼好的那份比对上一次通知时的骨架。
 *
 * ESA 首页不走通知：控制台缓存规则「首页遵循源站缓存」让边缘按源站 SWR 头
 * 自行过期与后台取新（见根目录 next.config.ts），需要立即生效时去控制台手动刷新。
 */
export async function expireStatusTags(
  tags: readonly string[],
): Promise<void> {
  if (!tags.length) return;
  let vibeCodingLayout: string | null = null;
  let pending = tags;
  if (tags.includes(VIBECODING_TAG)) {
    vibeCodingLayout = await currentVibeCodingLayout();
    if (vibeCodingLayout === (await notifiedVibeCodingLayout.get())?.key) {
      vibeCodingLayout = null;
      pending = tags.filter((tag) => tag !== VIBECODING_TAG);
    }
  }
  if (!pending.length) return;
  const delivered = await revalidateVercel(currentContext().env, pending);
  // 留一行好按 tag 分组数：首屏每小时重建多少次、是哪几张卡在触发，全看这里
  if (delivered) console.log("[revalidate]", pending.join(","));
  // 没送到就不记：下一次上报还会再比一次、再通知一次
  if (delivered && vibeCodingLayout !== null) {
    await notifiedVibeCodingLayout.put({ key: vibeCodingLayout, at: Date.now() });
  }
}

/** 上一次通知 Vercel 时 vibe coding 卡片的骨架 */
const notifiedVibeCodingLayout = mirrorKey<{ key: string; at: number }>(
  ["home-layout", "vibecoding"],
  (value) => value.at,
);

async function currentVibeCodingLayout(): Promise<string> {
  const envelope = await statusEnvelope(getVibeCodingSnapshot);
  return vibeCodingLayoutKey(envelope.ok ? envelope.data : null);
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
      // 带上站点给的原因：401 是密钥没对齐、400 是 tag 名单对不上，光看状态码要猜
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

/** 全站一个房间，和 index.ts 里 /ws 接入的是同一个 */
export const ROOM_ID = "global";

export async function publish(event: LiveEvent): Promise<void> {
  try {
    const { env } = currentContext();
    const room = env.LIVE_PUSH.get(env.LIVE_PUSH.idFromName(ROOM_ID));
    await room.broadcast(JSON.stringify(event));
  } catch (error) {
    console.error("[live]", event.type, error instanceof Error ? error.message : String(error));
  }
}
