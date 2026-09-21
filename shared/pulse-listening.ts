import { PULSE_HINT_MAX } from "@/lib/limits";
import type { ListeningItem } from "@/lib/types";
import { CODING_WINDOW_MS } from "@shared/pulse-coding";
import { compactHint } from "@shared/pulse-levels";

/**
 * 一次「最近在听」列表变动。
 *
 * Apple 这份列表按最后播放时间倒序，却不给时刻，所以能断言的只有区间：
 * 播放发生在上一轮成功刷新 `since` 和看见变化的这一刻 `t` 之间。
 */
export type ListeningPlay = {
  /** 看见变化的时刻，也就是这一轮刷新的 fetchedAt */
  t: number;
  /** 上一轮成功刷新的时刻 */
  since: number;
  /** 新排到前面的专辑 / 歌单名 */
  hint: string | null;
};

/**
 * 只比 id 和顺序。
 *
 * 不能拿整份 JSON 比（那是 prepareRecentlyPlayed 里 `changed` 的口径，它要管的是
 * 推不推给浏览器）：自建歌单封面是 12 小时一换的预签名地址，时长又只算第一项，
 * 两者都会变，而两者都不是「又放了什么」。
 */
export function playbackSignature(items: ListeningItem[]): string {
  return items.map((item) => item.id).join("\n");
}

/**
 * 两轮列表之间有没有发生播放。
 *
 * 没有上一份就返回 null：第一次拉回来的列表整份都是「新」的，却不代表刚刚在放，
 * 和 activityPulseSample 需要基线是同一个理由。
 */
export function listeningPlay(
  previous: { items: ListeningItem[]; fetchedAt: number } | null,
  next: { items: ListeningItem[]; fetchedAt: number },
): ListeningPlay | null {
  if (!previous || next.fetchedAt <= previous.fetchedAt) return null;
  if (playbackSignature(previous.items) === playbackSignature(next.items)) return null;
  const known = new Set(previous.items.map((item) => item.id));
  const fresh = next.items.filter((item) => !known.has(item.id));
  // 没有新条目就是老专辑被重放顶到了前面，那时最前面那项就是它。
  const named = fresh[0] ?? next.items[0] ?? null;
  return {
    t: next.fetchedAt,
    since: previous.fetchedAt,
    hint: named ? compactHint(named.artist, named.title) : null,
  };
}

/** 脏行丢掉，不因为一条坏 JSON 废掉整串证据。 */
export function parseListeningPlay(raw: string): ListeningPlay | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as { t?: unknown; since?: unknown; hint?: unknown };
    if (typeof row.t !== "number" || !Number.isFinite(row.t)) return null;
    if (typeof row.since !== "number" || !Number.isFinite(row.since) || row.since >= row.t) return null;
    const hint = typeof row.hint === "string" ? row.hint.trim().slice(0, PULSE_HINT_MAX) : "";
    return { t: row.t, since: row.since, hint: hint || null };
  } catch {
    return null;
  }
}

/**
 * 一次变动能认领多长的「已观测」时间。
 *
 * 只知道播放落在 `(since, t]` 里的某处，而这份列表由访客的轮询驱动刷新，没人看时
 * 这个口子能张到几小时。整段都算成已观测的话，一次换专辑就会按几小时的权重压过
 * 真实上报 —— 摘要是按覆盖时长加权的，见 summarizeAssessments。所以最多只认一个
 * 评分窗口那么长；余下的不确定性交给 Jev 的 confidence，state 里仍带着真实的
 * `since` 让它看得见口子有多大。
 */
export function listeningPlayCoverage(
  play: ListeningPlay,
  window: { from: number; to: number },
): { from: number; to: number } | null {
  const from = Math.max(window.from, play.since, play.t - CODING_WINDOW_MS);
  const to = Math.min(window.to, play.t);
  return to > from ? { from, to } : null;
}

/** 进 state 的那段说明。档位图例说不了它 —— 它根本不在档位序列上。 */
export const RECENTLY_PLAYED_CRITERIA =
  "Each recentlyPlayed mark means the Apple Music recently played list gained or reordered an album, playlist or station, so something was played on some device — including devices that have no live reporter, which is the only evidence those devices leave. A mark says nothing about how long playback lasted. It is placed in (since, observedAt]: the wider that gap, the less certain the placement, so lower confidence rather than claiming more time. coveredFrom and coveredTo are the only observed time it contributes. An unchanged list is not idle — staying on one album changes nothing.";
