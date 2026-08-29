import { AwaitingReport } from "@/lib/api";
import { nextObservation, type Observation } from "@/lib/apple-music-observation";
import { mirrorKey } from "@/lib/redis";
import type { ListeningItem, ListeningPayload, NowPlayingGuess } from "@/lib/types";

/**
 * 「最近在听」的落库，以及那份推断所依赖的观测状态。
 *
 * 两个键，都在这里：
 *
 * 1. `apple-music:recent` —— 拉回来的整份列表。**一个键装整份**，所以访客读它
 *    只有一次 Redis（命中 `'use cache'` 时连这一次都没有）。曾经每个 item 各走
 *    一次缓存，十项就是十个来回，那是把这件事搬出站点的理由之一；形状换成这样
 *    之后那笔开销就不在了。
 * 2. `apple-music:observed` —— 上一次看见排在最前的是谁、它是什么时候换上来的。
 *    这一份从前存在进程内存里，serverless 上每个实例各有一份、活不到下一次切换，
 *    于是「此刻在不在听」永远推断不出来 —— 挪进 Redis 才是把拉取收回站点的前提，
 *    见 lib/apple-music-recent。
 *
 * Redis 为主、进程内存为辅，规则见 lib/redis 的 mirrorKey。
 */

/**
 * 存的是内容本身。`fetchedAt` 单独放在外面，它是代数不是新鲜度 —— 这张卡没有
 * 陈旧判定（一份冻住的「最近在听」本身没有错），用处见 ListeningPayload。
 * inferred 不落库：它是 nowPlaying 对上哪一项的派生字段，读取时现盖。
 */
type StoredItem = Omit<ListeningItem, "inferred">;
export type StoredListening = {
  items: StoredItem[];
  nowPlaying: NowPlayingGuess | null;
};

function withInferred(payload: StoredListening): Pick<ListeningPayload, "items" | "nowPlaying"> {
  const itemId = payload.nowPlaying?.itemId;
  return {
    nowPlaying: payload.nowPlaying,
    items: payload.items.map((item) => ({
      ...item,
      inferred: itemId != null && item.id === itemId,
    })),
  };
}

const mirror = mirrorKey<{ payload: StoredListening; fetchedAt: number }>(
  ["apple-music", "recent"],
  (state) => state.fetchedAt,
);

/** 只比内容，不比拉取时刻 —— 每轮刷新都会重写 fetchedAt，那不该算变化 */
function sameContent(a: StoredListening, b: StoredListening) {
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
  payload: StoredListening,
  fetchedAt = Date.now(),
): Promise<{
  changed: boolean;
  listening: ListeningPayload;
  commit: () => Promise<void>;
}> {
  const previous = await mirror.get();
  const changed = !previous || !sameContent(previous.payload, payload);

  return {
    changed,
    listening: { ...withInferred(payload), fetchedAt },
    commit: () => mirror.put({ payload, fetchedAt }),
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
  return { ...withInferred(state.payload), fetchedAt: state.fetchedAt };
}

/**
 * 看一眼排在最前的那一项，返回它是什么时候换上来的（不知道就是 null）。
 *
 * 判断本身是纯函数，连同它的理由一起在 lib/apple-music-observation；这里只负责
 * 把上一次的状态取出来、把新的写回去。
 */
const observation = mirrorKey<Observation>(
  ["apple-music", "observed"],
  (value) => value.observedAt,
);

export async function observeTopItem(
  id: string,
  now: number,
  /** 两次观测隔多久就当断了。由调用方按自己的刷新节奏定，见 lib/apple-music-recent */
  gapMs: number,
): Promise<number | null> {
  const seen = nextObservation(await observation.get(), id, now, gapMs);
  await observation.put(seen);
  return seen.switchedAt;
}
