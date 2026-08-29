import { AwaitingReport } from "@/lib/api";
import { mirrorKey } from "@/lib/redis";
import type { ListeningItem, ListeningPayload } from "@/lib/types";

/**
 * 「最近在听」的落库。
 *
 * **一个键装整份**，所以访客读它只有一次 Redis（命中 `'use cache'` 时连这一次
 * 都没有）。曾经每个 item 各走一次缓存，十项就是十个来回 —— 那是当初把这件事
 * 搬去常驻上报器的理由之一，形状换成这样之后那笔开销就不在了，和进不进程无关。
 *
 * Redis 为主、进程内存为辅，规则见 lib/redis 的 mirrorKey。
 */

/**
 * `fetchedAt` 单独放在外面，它是代数不是新鲜度 —— 这张卡没有陈旧判定
 * （一份冻住的「最近在听」本身没有错），用处见 ListeningPayload。
 */
const mirror = mirrorKey<{ items: ListeningItem[]; fetchedAt: number }>(
  ["apple-music", "recent"],
  (state) => state.fetchedAt,
);

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
    commit: () => mirror.put({ items, fetchedAt }),
  };
}

/**
 * 取「最近在听」。
 *
 * 一次都还没拉到过时明确报错，不返回空列表 —— 空列表的意思是「你最近什么都没听」，
 * 而这里的实情是「站点手上还没有这份数据」，两件事的修法完全不同。这个状态是
 * 正常的、短暂的：Redis 空着的第一个访客会看到它，他自己那次
 * `/api/status/listening/now` 轮询就会把列表拉回来，推送随即把卡片点亮。
 */
export async function getRecentlyPlayed(): Promise<ListeningPayload> {
  const state = await mirror.get();
  if (!state) {
    if (await mirror.reachable()) {
      throw new AwaitingReport("还没有拉到过 Apple Music 最近播放");
    }
    throw new Error("读不到「最近在听」—— Redis 连不上，数据本身可能还在");
  }
  return { items: state.items, fetchedAt: state.fetchedAt };
}
