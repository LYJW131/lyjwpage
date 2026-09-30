"use client";
import { backendUrl } from "@/lib/backend-url";
import { useEffect, useState } from "react";

import type { LyricLine } from "@/lib/lyrics-ttml";


const LYRICS_ENDPOINT = "/api/lyrics";
// LyricsResult 形状变更时须升级此键，避免长缓存继续返回旧形状。
const LYRICS_FORMAT = 4;

// 404 也可能是订阅身份暂不可用，空结果不能永久缓存。
const EMPTY_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 5_000;

export type CachedLyricsData = {
  lines: LyricLine[];
  songwriters?: string[];
};

export type LyricsFallback = CachedLyricsData & { songId: string };

const lyricsCache = new Map<string, CachedLyricsData>();
const emptyUntil = new Map<string, number>();
const pending = new Map<string, Promise<CachedLyricsData | null>>();

function cachedLyrics(songId: string): CachedLyricsData | null | undefined {
  const hit = lyricsCache.get(songId);
  if (hit) return hit;
  const until = emptyUntil.get(songId);
  if (until != null && Date.now() < until) return null;
  return undefined;
}

async function fetchLyrics(songId: string): Promise<CachedLyricsData | null> {
  const known = cachedLyrics(songId);
  if (known !== undefined) return known;
  const running = pending.get(songId);
  if (running) return running;

  const promise = (async () => {
    try {
      const response = await fetch(
        backendUrl(`${LYRICS_ENDPOINT}?song=${encodeURIComponent(songId)}&format=${LYRICS_FORMAT}`),
      );
      if (!response.ok) {
        emptyUntil.set(songId, Date.now() + FAILURE_TTL_MS);
        return null;
      }
      const data = (await response.json()) as {
        lines?: LyricLine[];
        songwriters?: string[];
      };
      const lines = Array.isArray(data.lines) ? data.lines : [];
      const payload: CachedLyricsData = {
        lines,
        songwriters:
          Array.isArray(data.songwriters) && data.songwriters.length
            ? data.songwriters
            : undefined,
      };


      if (lines.length) {
        lyricsCache.set(songId, payload);
        return payload;
      }
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

export type UseLyricsResult = {
  lyrics: LyricLine[] | null;
  songwriters?: string[];
  isLoading: boolean;
};

export function useLyrics(
  songId: string | null,
  hasLyrics: boolean,
  initialData?: LyricsFallback | null,
): UseLyricsResult {
  const key = songId && hasLyrics ? songId : null;
  const initialSongData = key && initialData?.songId === key ? initialData : null;

  if (key && initialSongData?.lines.length && !lyricsCache.has(key)) {
    lyricsCache.set(key, initialSongData);
  }

  const [resolved, setResolved] = useState<{
    songId: string;
    data: CachedLyricsData | null;
  } | null>(() => {
    if (!key || !initialSongData?.lines.length) return null;
    return { songId: key, data: initialSongData };
  });

  // 同曲目 key 不变，负缓存到期须主动重触发 effect 才能恢复请求。
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    const known = cachedLyrics(key);
    if (known !== undefined) {
      if (known !== null) return;
      const until = emptyUntil.get(key);
      if (until == null) return;
      const timer = window.setTimeout(
        () => setAttempt((n) => n + 1),
        Math.max(0, until - Date.now()),
      );
      return () => window.clearTimeout(timer);
    }

    let active = true;
    fetchLyrics(key).then((data) => {
      if (!active) return;
      setResolved({ songId: key, data });
      if (data === null) setAttempt((n) => n + 1);
    });

    return () => {
      active = false;
    };
  }, [key, attempt]);

  if (!key) return { lyrics: null, isLoading: false };

  const known = cachedLyrics(key);
  const data = known !== undefined ? known : resolved?.songId === key ? resolved.data : null;
  const isLoading = known === undefined && resolved?.songId !== key;

  return {
    lyrics: data?.lines && data.lines.length ? data.lines : null,
    songwriters: data?.songwriters,
    isLoading,
  };
}
