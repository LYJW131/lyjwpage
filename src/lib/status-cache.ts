import { cacheLife, cacheTag } from "next/cache";
import { STATUS_TAGS } from "@/lib/status-tags";
import type { HomeSnapshot } from "@/lib/public-home";
import { backendUrl } from "@/lib/backend-url";

export type CachedHomeSnapshot = {
  snapshot: HomeSnapshot;
  /** 向 Worker 发请求的时刻；浏览器挂载时拿它挡掉比首屏还旧的 KV 聚合 */
  fetchedAt: number;
};

/**
 * 首屏先返回已有 HTML；展示内容变化只标 stale，重建在后台读取一次公开快照。
 *
 * 带 `fresh=1` 直读 DO：重建是上报触发的，而 KV 里的 `/api/home` 投影要慢它
 * 最多一分钟，走 KV 会把刚发生的变化重建成旧的、再顶到下一次失效。重建本来
 * 就只在变化时跑一次，这一次回源的代价可以忽略。
 */
export async function cachedHomeSnapshot(): Promise<CachedHomeSnapshot> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 600, expire: 7 * 86400 });
  cacheTag(...STATUS_TAGS.map((tag) => `page:${tag}`));
  const fetchedAt = Date.now();
  const response = await fetch(backendUrl("/api/home?fresh=1"), { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Backend snapshot: ${response.status}`);
  return { snapshot: await response.json(), fetchedAt };
}
