import type { ListeningItem, ListeningPayload } from "@/lib/types";
import { recordStateChange } from "@api/stores/state-journal";
import { mirror } from "@shared/apple-music-store";
import { listeningPlay, type ListeningPlay } from "@shared/pulse-listening";
import { listeningListState } from "@shared/state-journal";

/** 只比内容，不比拉取时刻 —— 每轮刷新都会重写 fetchedAt，那不该算变化 */
function sameContent(a: ListeningItem[], b: ListeningItem[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 收下刚拉回来的一份：先比，写留给 commit。
 *
 * `changed` 是内容变没变，调用方据此决定要不要推给浏览器和失效缓存 —— 大多数轮次
 * 什么都没变，跟着推就成了定时广播。
 *
 * `listening` 就是要推的那整份，和落库那份同源，所以写和推能同时发车（见 fanout
 * 的规则 1）。从前这一步是把刚写进去的东西再读回来，白等一个来回。
 *
 * `play` 是另一个口径：`changed` 管「要不要推」，封面地址换了也算；它只管「有没有
 * 又放了什么」，只比 id 和顺序。两者不能合并 —— 拿 `changed` 当活动证据的话，每 12
 * 小时换一次的自建歌单封面地址就会凭空变出一次播放。见 shared/pulse-listening。
 */
export async function prepareRecentlyPlayed(
  items: ListeningItem[],
  fetchedAt = Date.now(),
): Promise<{
  changed: boolean;
  play: ListeningPlay | null;
  listening: ListeningPayload;
  commit: () => Promise<void>;
}> {
  const previous = await mirror.get();
  const changed = !previous || !sameContent(previous.items, items);

  return {
    changed,
    play: listeningPlay(previous, { items, fetchedAt }),
    listening: { items, fetchedAt },
    commit: async () => {
      await mirror.put({ items, fetchedAt });
      await recordStateChange("listening", fetchedAt, listeningListState(items));
    },
  };
}
