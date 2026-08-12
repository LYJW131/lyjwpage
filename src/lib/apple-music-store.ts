import { number, object, text } from "@/lib/json";
import { mirrorKey } from "@/lib/redis";
import type { ListeningItem, ListeningPayload, NowPlayingGuess } from "@/lib/types";

/**
 * 「最近在听」的落库。
 *
 * 这份列表从前是站点自己去 api.music.apple.com 拉的 —— 全站唯一一路主动回源。
 * 现在由 reporters/apple-music-reporter 推来，站点这侧只剩一次 Redis 读。
 *
 * 换掉的理由不只是省调用：判断「此刻在不在听」要靠观测最近播放列表里排第一的
 * 那项**什么时候变成第一的**，而那个观测状态从前存在进程内存里 —— serverless
 * 上每个实例各有一份、活不到下一次切换，等于永远推断不出来。观测这件事需要一个
 * 常驻进程按固定节奏做，那就是上报器。
 *
 * Redis 为主、进程内存为辅，规则见 lib/redis 的 mirrorKey。
 */

/** 存的是内容本身；stale 是「多久没推了」，读的时候现算，不落库 */
type StoredListening = Omit<ListeningPayload, "stale">;

const mirror = mirrorKey<{ payload: StoredListening; pushedAt: number }>(
  ["apple-music", "recent"],
  (state) => state.pushedAt,
);

/**
 * 上报器没推的时间超过这个就算陈旧。
 *
 * 它 60 秒轮一次上游、10 分钟兜底整推一次，所以三倍兜底间隔还没消息就是它出事了。
 * 注意陈旧在这张卡上和别处含义不同：一份冻住的「最近在听」本身没有错，只是可能
 * 漏掉了在别处的播放，所以调用方不该照搬别的卡那种整张变灰的处理。
 */
const PUSH_STALE_MS = 30 * 60_000;

/** 只比内容，不比推送时刻 —— 上报器每 10 分钟会整份重推一次，那次不该算变化 */
function sameContent(a: StoredListening, b: StoredListening) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function reportItem(value: unknown): ListeningItem | null {
  const row = object(value);
  if (!row) return null;
  const id = text(row.id);
  if (!id) return null;

  const palette = Array.isArray(row.palette)
    ? row.palette.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    id,
    title: text(row.title) ?? "",
    artist: text(row.artist) ?? "",
    artwork: text(row.artwork),
    link: text(row.link),
    palette,
    durationMs: number(row.durationMs),
  };
}

function reportNowPlaying(value: unknown): NowPlayingGuess | null {
  const row = object(value);
  if (!row) return null;
  const itemId = text(row.itemId);
  const startedAt = number(row.startedAt);
  const durationMs = number(row.durationMs);
  // 三者缺一就整个作废：少了任何一个都算不出进度，留半份只会在前端炸开
  if (!itemId || !startedAt || !durationMs) return null;
  return { itemId, startedAt, durationMs };
}

/**
 * 收下上报器的一次推送。
 *
 * 返回内容变没变，调用方据此决定要不要推给浏览器 —— 兜底整推每 10 分钟就来一次，
 * 收到就推的话推送会退化成定时广播。
 */
export async function recordRecentlyPlayedReport(
  body: unknown,
): Promise<{ items: number; changed: boolean }> {
  const root = object(body);
  if (!root) throw new Error("请求体不是对象");
  if (!Array.isArray(root.items)) throw new Error("items 必须是数组");

  const payload: StoredListening = {
    items: root.items
      .map(reportItem)
      .filter((item): item is ListeningItem => item != null),
    // 缺席、null、算不出来都是「此刻没在听」，不区分
    nowPlaying: reportNowPlaying(root.nowPlaying),
  };

  const previous = await mirror.get();
  const changed = !previous || !sameContent(previous.payload, payload);
  await mirror.put({ payload, pushedAt: Date.now() });

  return { items: payload.items.length, changed };
}

/**
 * 取「最近在听」。
 *
 * 从没收到过推送时明确报错，不返回空列表 —— 空列表的意思是「你最近什么都没听」，
 * 而这里的实情是「上报器没在跑」，两件事的修法完全不同。
 */
export async function getRecentlyPlayed(): Promise<ListeningPayload> {
  const state = await mirror.get();
  if (!state) {
    throw new Error(
      (await mirror.reachable())
        ? "尚未收到 Apple Music 上报器的推送"
        : "读不到「最近在听」—— Redis 连不上，数据本身可能还在",
    );
  }
  return { ...state.payload, stale: Date.now() - state.pushedAt > PUSH_STALE_MS };
}
