import { cacheLife, cacheTag } from "next/cache";

import { backendUrl } from "@/lib/backend-url";
import type { LyricsResult } from "@/lib/lyrics";
import type { EndpointPayloadOf } from "@/lib/status-loaders";
import { STATUS_VIEWS, type StatusView, type StatusViewKey } from "@/lib/status-views";
import type { StatusResponse } from "@/lib/types";

/**
 * 首屏按卡读取：每张卡一条缓存，各挂自己的 `page:<tag>`，各读自己的端点。
 *
 * 从前是一次 `/api/home` 把实时卡和慢卡绑在一次读取里，慢卡现拉上游时会拖住整个
 * 首屏。现在实时卡的端点读状态核心 DO，可滞后卡的端点读 KV，任何一条都不在请求
 * 路径上现拉外部 API。某个标签失效只让那一张卡回源，整页在后台重建。
 *
 * 失败的处理和从前一样：网络错误、5xx 抛出去，Next 继续用已有的那份缓存，不拿
 * 错误覆盖好的首屏。端点还没部署（Worker 比站点晚上线时的 404）不抛，降级成那张卡
 * 自己的「暂不可用」，别让一张新卡把整页拖进错误边界。
 */

const FETCH_TIMEOUT_MS = 20_000;

export type FirstScreen<K extends StatusViewKey> = StatusResponse<EndpointPayloadOf<K>>;

export async function firstScreen<K extends StatusViewKey>(key: K): Promise<FirstScreen<K>> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 600, expire: 7 * 86400 });
  const view: StatusView = STATUS_VIEWS[key];
  if (view.tag) cacheTag(`page:${view.tag}`);
  const response = await fetch(backendUrl(view.path), {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return { ok: false, error: "Status unavailable" };
  if (!response.ok) throw new Error(`First screen ${view.path}: ${response.status}`);
  return response.json();
}

/**
 * 此刻那首的同步歌词。歌词只由曲目决定，Worker 那侧有机房级缓存；这里再按曲目
 * 缓存一份，换歌之前的重建都不再回源。拿不到就没有首屏歌词，卡片挂载后自己取。
 */
export async function firstScreenLyrics(songId: string): Promise<LyricsResult | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  try {
    const response = await fetch(backendUrl(`/api/lyrics?song=${encodeURIComponent(songId)}`), {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as LyricsResult;
  } catch {
    return null;
  }
}
