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
      const data = response.ok ? ((await response.json()) as { lines?: LyricLine[] }) : null;
      const lines = Array.isArray(data?.lines) ? data.lines : [];
      if (lines.length) {
        lyricsCache.set(songId, lines);
        return lines;
      }
      emptyUntil.set(songId, Date.now() + EMPTY_TTL_MS);
      return null;
    } catch {
      emptyUntil.set(songId, Date.now() + EMPTY_TTL_MS);
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

  useEffect(() => {
    if (!key || cachedLyrics(key) !== undefined) return;

    let active = true;
    fetchLyrics(key).then((lines) => {
      if (active) setResolved({ songId: key, lines });
    });

    return () => {
      active = false;
    };
  }, [key]);

  if (!key) return null;

  const known = cachedLyrics(key);
  const lines = known !== undefined ? known : resolved?.songId === key ? resolved.lines : null;
  return lines && lines.length ? lines : null;
}
