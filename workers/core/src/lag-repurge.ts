import { STATUS_VIEWS } from "@shared/status-views";

// 可滞后层的 KV 写入要等各机房的读缓存（默认 cacheTtl 60 秒）过期才处处可见；写完立刻失效后，
// 这段时间里别的机房重建首屏快照会把旧值再缓存一整轮，所以过了这段再失效一次。
export const LAG_REPURGE_DELAY_MS = 65_000;

const LAG_TAGS = new Set<string>(
  Object.values(STATUS_VIEWS).flatMap((view) => (view.layer === "lag" && "tag" in view ? [view.tag] : [])),
);

export function lagStatusTags(tags: readonly string[]): string[] {
  return [...new Set(tags.filter((tag) => LAG_TAGS.has(tag)))];
}

export type RepurgeQueue = Record<string, number>;

export function queueRepurge(queue: RepurgeQueue, tags: readonly string[], at: number): RepurgeQueue {
  const next = { ...queue };
  for (const tag of tags) next[tag] = Math.max(next[tag] ?? 0, at);
  return next;
}

export function takeDueRepurge(
  queue: RepurgeQueue,
  now: number,
): { due: string[]; rest: RepurgeQueue; next: number | null } {
  const due: string[] = [];
  const rest: RepurgeQueue = {};
  for (const [tag, at] of Object.entries(queue)) {
    if (at <= now) due.push(tag);
    else rest[tag] = at;
  }
  const pending = Object.values(rest);
  return { due, rest, next: pending.length ? Math.min(...pending) : null };
}
