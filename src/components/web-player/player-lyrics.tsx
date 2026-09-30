"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { HeroLyrics, HeroLyricsSkeleton } from "@/components/live/hero-lyrics";
import { useLyrics } from "@/hooks/use-lyrics";
import { PLAYBACK_STATE, type MediaItem, type MusicKitInstance } from "@/lib/musickit";
import { catalogItemId } from "@/lib/playing-queue";
import { trackPositionMs } from "@/lib/track-position";
import type { LocalNowPlaying } from "@/lib/types";

export function PlayerLyrics({
  instance,
  nowPlaying,
  active,
  seekEvent,
  previewing = false,
}: {
  instance: MusicKitInstance | null;
  nowPlaying: MediaItem | null;
  active: boolean;
  seekEvent?: { targetMs: number; at: number } | null;
  previewing?: boolean;
}) {
  const songId = active && !previewing ? catalogItemId(nowPlaying?.id) : null;
  const hasLyrics = nowPlaying?.attributes?.hasLyrics ?? true;
  const { lyrics, songwriters, isLoading } = useLyrics(songId, hasLyrics);
  const reduced = useReducedMotion();
  const [anchor, setAnchor] = useState<LocalNowPlaying | null>(null);
  const anchorRef = useRef<LocalNowPlaying | null>(null);

  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);

  const [prevSeekEvent, setPrevSeekEvent] = useState(seekEvent);
  if (seekEvent !== prevSeekEvent) {
    setPrevSeekEvent(seekEvent);
    if (seekEvent && instance && songId) {
      const attributes = nowPlaying?.attributes;
      setAnchor({
        source: "apple-music",
        state: instance.playbackState === PLAYBACK_STATE.playing ? "playing" : "paused",
        title: attributes?.name ?? null,
        artist: attributes?.artistName ?? null,
        album: attributes?.albumName ?? null,
        trackId: songId,
        artworkUrl: null,
        positionMs: Math.max(0, seekEvent.targetMs),
        durationMs: Math.max(0, (instance.currentPlaybackDuration || 0) * 1000),
        repeatOne: false,
        observedAt: seekEvent.at,
      });
    }
  }

  useEffect(() => {
    if (!instance || !songId) return;
    const attributes = nowPlaying?.attributes;

    const syncAnchor = () => {
      const now = Date.now();
      const posSec = instance.currentPlaybackTime || 0;
      const posMs = Math.max(0, posSec * 1000);
      const isPlaying = instance.playbackState === PLAYBACK_STATE.playing;

      setAnchor({
        source: "apple-music",
        state: isPlaying ? "playing" : "paused",
        title: attributes?.name ?? null,
        artist: attributes?.artistName ?? null,
        album: attributes?.albumName ?? null,
        trackId: songId,
        artworkUrl: null,
        positionMs: posMs,
        durationMs: Math.max(0, (instance.currentPlaybackDuration || 0) * 1000),
        repeatOne: false,
        observedAt: now,
      });
    };

    syncAnchor();

    const onState = () => syncAnchor();

    // 正常播放不重建歌词锚点，避免音频时间戳抖动打断平滑推进。
    const onTime = () => {
      if (!anchorRef.current) return;
      const isPlaying = instance.playbackState === PLAYBACK_STATE.playing;
      if (!isPlaying) return;

      const currentMs = Math.max(0, (instance.currentPlaybackTime || 0) * 1000);
      const estimatedMs = trackPositionMs(anchorRef.current, Date.now());
      const diff = Math.abs(currentMs - estimatedMs);

      if (diff > 1500) {
        syncAnchor();
      }
    };

    instance.addEventListener("playbackStateDidChange", onState);
    instance.addEventListener("playbackTimeDidChange", onTime);
    return () => {
      instance.removeEventListener("playbackStateDidChange", onState);
      instance.removeEventListener("playbackTimeDidChange", onTime);
    };
  }, [instance, songId, nowPlaying]);

  if (!songId || previewing) return null;
  if (!lyrics && !isLoading) return null;
  const track = anchor?.trackId === songId ? anchor : null;

  return (
    <div className="mt-3 border-t border-line pt-2">
      {lyrics && track ? (
        <HeroLyrics
          lyrics={lyrics}
          track={track}
          songwriters={songwriters}
          reduced={Boolean(reduced)}
        />
      ) : (
        <HeroLyricsSkeleton />
      )}
    </div>
  );
}
