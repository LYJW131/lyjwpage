import type { WatchingItem } from "@/lib/types";

/** 页面上那两行字。同一集的 BD / WEB 共用元数据，对得上就是同一部。 */
export function watchingIdentity(item: Pick<WatchingItem, "title" | "subtitle">): string {
  return `${item.title}\n${item.subtitle}`;
}

/** 正在播的那一集：Id 对得上，或和 current 是同一部的另一个版本。 */
export function isNowWatching(
  item: WatchingItem,
  nowPlayingId: string | undefined,
  current: WatchingItem | null,
): boolean {
  if (!nowPlayingId) return false;
  if (item.id === nowPlayingId) return true;
  return current != null && watchingIdentity(item) === watchingIdentity(current);
}

/**
 * 把播放中那一项从续播列表里拎出来单独放大，剩下的去重后铺成一排。
 *
 * 从前是置顶：播放中那张排在行首、其余跟在后面。现在它有自己的一块（剧照、设备、
 * 规格、进度），再留在行里就是同一集出现两次。
 *
 * 详情（`current`）比 webhook 晚到一拍很正常，那一拍里若续播列表正好有这一项
 * 就先拿它顶上；两边都没有时 hero 为 null，卡片画一块只有状态没有标题的占位。
 *
 * 去重不能只按 Id：Emby 同一集的 BD / WEB 是两个条目，续播给合并项、正在播放
 * 给实际文件，Id 对不上就会并排两张一模一样的卡。没在播时列表里的重复也照并。
 */
export function splitNowWatching(
  items: WatchingItem[],
  nowPlayingId: string | undefined,
  current: WatchingItem | null,
): { hero: WatchingItem | null; rest: WatchingItem[] } {
  const hero = nowPlayingId
    ? (current ?? items.find((item) => item.id === nowPlayingId) ?? null)
    : null;

  const rest: WatchingItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (isNowWatching(item, nowPlayingId, hero)) continue;
    const key = watchingIdentity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    rest.push(item);
  }
  return { hero, rest };
}
