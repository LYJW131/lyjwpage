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

const lyricsCache = new Map<string, LyricLine[]>();
const pending = new Map<string, Promise<LyricLine[] | null>>();

async function fetchLyrics(songId: string): Promise<LyricLine[] | null> {
  const hit = lyricsCache.get(songId);
  if (hit) return hit;
  const running = pending.get(songId);
  if (running) return running;

  const promise = (async () => {
    try {
      const response = await fetch(`${LYRICS_ENDPOINT}?song=${encodeURIComponent(songId)}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { lines?: LyricLine[] };
      const lines = Array.isArray(data.lines) ? data.lines : [];
      lyricsCache.set(songId, lines);
      return lines;
    } catch {
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
    if (!key || lyricsCache.has(key)) return;

    let active = true;
    fetchLyrics(key).then((lines) => {
      if (active) setResolved({ songId: key, lines });
    });

    return () => {
      active = false;
    };
  }, [key]);

  if (!key) return null;

  const cached = lyricsCache.get(key);
  const lines = cached ?? (resolved?.songId === key ? resolved.lines : null);
  return lines && lines.length ? lines : null;
}
