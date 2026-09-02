import { useEffect, useState } from "react";

import type { LyricLine } from "@/lib/lyrics-ttml";

/**
 * 此刻那首的同步歌词，和 use-motion-artwork 同一个形状：按键存一份模块级缓存，
 * 换歌时不用先清状态 —— 结果连着它属于哪首一起存，渲染时比一下键就知道旧的
 * 不作数。
 *
 * 键是目录曲目 ID（`NowListeningPayload.songId`，调用方传的是闩住的那份，见
 * listening-card 的 lookupLatch）。只在目录说 `hasLyrics` 时才问：目录说没有的
 * 那首，问了也是 404，还会占一条「没有」的缓存。
 */

const LYRICS_ENDPOINT = "/api/lyrics";

/**
 * 「没有」只记一小时，和服务端那条负缓存同一个尺度（lib/lyrics 的
 * NO_LYRICS_TTL_MS）。服务端的 404 分不清「这首没词」和「订阅身份那一刻没被认」，
 * 所以它只把「没有」留一小时；浏览器这边要是把空数组永久记住，一个开着不动的
 * 页面就会在凭据恢复之后仍旧对这首歌只显示艺人名，直到整页刷新。
 */
const EMPTY_TTL_MS = 60 * 60 * 1000;
/**
 * 接口没答上来（非 2xx、网络断）只挡几秒，和服务端那条 5 秒负缓存一个尺度。
 * 这不是「没有歌词」，是「这会儿问不到」，记一小时等于把上游抖一下放大成整首歌
 * 都没词。
 */
const FAILURE_TTL_MS = 5_000;

/** 有词的一首歌不会变，整个页面生命周期内只问一次 */
const lyricsCache = new Map<string, LyricLine[]>();
/** 问过但没有（或接口失败）的，记到什么时候为止 */
const emptyUntil = new Map<string, number>();
const pending = new Map<string, Promise<LyricLine[] | null>>();

function cachedLyrics(songId: string): LyricLine[] | null | undefined {
  const hit = lyricsCache.get(songId);
  if (hit) return hit;
  const until = emptyUntil.get(songId);
  if (until != null && Date.now() < until) return null;
  return undefined;
}

async function fetchLyrics(songId: string): Promise<LyricLine[] | null> {
  const known = cachedLyrics(songId);
  if (known !== undefined) return known;
  const running = pending.get(songId);
  if (running) return running;

  const promise = (async () => {
    try {
      const response = await fetch(`${LYRICS_ENDPOINT}?song=${encodeURIComponent(songId)}`);
      if (!response.ok) {
        emptyUntil.set(songId, Date.now() + FAILURE_TTL_MS);
        return null;
      }
      const data = (await response.json()) as { lines?: LyricLine[] };
      const lines = Array.isArray(data.lines) ? data.lines : [];
      if (lines.length) {
        lyricsCache.set(songId, lines);
        return lines;
      }
      // 服务端明确说了「没有」（可能是没词，也可能是订阅身份那一刻没被认）
      emptyUntil.set(songId, Date.now() + EMPTY_TTL_MS);
      return null;
    } catch {
      emptyUntil.set(songId, Date.now() + FAILURE_TTL_MS);
      return null;
    } finally {
      pending.delete(songId);
    }
  })();

  pending.set(songId, promise);
  return promise;
}

/**
 * 有同步歌词就是非空数组；没有（目录说没有、接口失败、还没回来）一律 null，
 * 调用方退回艺人名那一行。
 */
export function useLyrics(songId: string | null, hasLyrics: boolean): LyricLine[] | null {
  const key = songId && hasLyrics ? songId : null;
  const [resolved, setResolved] = useState<{ songId: string; lines: LyricLine[] | null } | null>(
    null,
  );

  /**
   * 负缓存到期要能自己再问一次。
   *
   * 同一首一直放着时 `key` 不变，effect 不会重跑，emptyUntil 过了期也没人发现 ——
   * 5 秒那档就白设了：开头一次网络抖动，整首歌都不会再问。到期那一刻拨一下
   * `attempt`，effect 重跑，cachedLyrics 已经不认那条过期的负缓存，于是重新去问。
   */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    const known = cachedLyrics(key);
    if (known !== undefined) {
      if (known !== null) return;
      const until = emptyUntil.get(key);
      if (until == null) return;
      const timer = window.setTimeout(() => setAttempt((n) => n + 1), Math.max(0, until - Date.now()));
      return () => window.clearTimeout(timer);
    }

    let active = true;
    fetchLyrics(key).then((lines) => {
      if (active) setResolved({ songId: key, lines });
    });

    return () => {
      active = false;
    };
    // attempt 只为在负缓存到期那一刻重跑一遍，effect 本身不读它
  }, [key, attempt]);

  if (!key) return null;

  const known = cachedLyrics(key);
  const lines = known !== undefined ? known : resolved?.songId === key ? resolved.lines : null;
  return lines && lines.length ? lines : null;
}
