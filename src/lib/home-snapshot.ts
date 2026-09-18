import { cacheLife, cacheTag } from "next/cache";
import { STATUS_TAGS } from "@/lib/status-views";
import type { HomeSnapshot } from "@/lib/public-home";
import { backendUrl } from "@/lib/backend-url";

/**
 * 首屏先返回已有 HTML；展示内容变化只标 stale，重建在后台读取一次公开快照。
 * `/api/home` 不进 KV，这里和浏览器挂载那一次读到的都是 DO 此刻的状态。
 */
export async function cachedHomeSnapshot(): Promise<HomeSnapshot> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 600, expire: 7 * 86400 });
  cacheTag(...STATUS_TAGS.map((tag) => `page:${tag}`));
  const response = await fetch(backendUrl("/api/home"), { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Backend snapshot: ${response.status}`);
  return response.json();
}
