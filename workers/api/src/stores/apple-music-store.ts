import type { ListeningItem, ListeningPayload } from "@/lib/types";
import { mirror } from "@shared/apple-music-store";

/** 只比内容，不比拉取时刻 —— 每轮刷新都会重写 fetchedAt，那不该算变化 */
function sameContent(a: ListeningItem[], b: ListeningItem[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 收下刚拉回来的一份：先比，写留给 commit。
 *
 * `changed` 是内容变没变，调用方据此决定要不要把 `listening` 推给浏览器（不涉及首屏失效）——
 * 大多数轮次什么都没变，跟着推就成了定时广播。
 *
 * `listening` 就是要推的那整份，和落库那份同源，推送直接用它，不必再读回来；
 * 落库确认之后才派发，见 workers/api/src/fanout.ts。
 *
 * 这份专辑粒度的列表不当 Pulse 的播放痕迹用，痕迹看单曲列表，见 stores/listening-pulse。
 */
export async function prepareRecentlyPlayed(
  items: ListeningItem[],
  fetchedAt = Date.now(),
): Promise<{
  changed: boolean;
  listening: ListeningPayload;
  commit: () => Promise<void>;
}> {
  const previous = await mirror.get();
  const changed = !previous || !sameContent(previous.items, items);

  return {
    changed,
    listening: { items, fetchedAt },
    commit: async () => {
      await mirror.put({ items, fetchedAt });
    },
  };
}
