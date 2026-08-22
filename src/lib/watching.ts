import type { WatchingItem } from "@/lib/types";

/** 页面上那两行字。同一集的 BD / WEB 共用元数据，对得上就是同一部。 */
export function watchingIdentity(item: Pick<WatchingItem, "title" | "subtitle">): string {
  return `${item.title}\n${item.subtitle}`;
}

/**
 * 播放中那一项置顶，并按「看起来是不是同一部」去重。
 *
 * Emby 会把同一集的多个版本（BD / WEB）收成一组：续播列表给的是合并项的
 * Id，正在播放给的是实际在播的那个文件的 Id。只按 Id 去重会并排摆两张
 * 一模一样的卡。
 *
 * 置顶那一项的 progress 是换片时取的详情，之后不再更新。续播列表会跟着
 * UserData 改。并掉重复项时条用续播那份 —— 不是取更高：拖回去、重看时
 * 续播更低才是现在的位置。
 */
export function pinNowWatching(
  items: WatchingItem[],
  current: WatchingItem | null,
): WatchingItem[] {
  const pinned = current ? [current, ...items] : items;
  const out: WatchingItem[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of pinned) {
    const key = watchingIdentity(item);
    const existing = indexByKey.get(key);
    if (existing == null) {
      indexByKey.set(key, out.length);
      out.push(item);
      continue;
    }
    if (current && out[existing].id === current.id) {
      out[existing] = { ...out[existing], progress: item.progress };
    }
  }
  return out;
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
