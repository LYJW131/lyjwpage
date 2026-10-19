"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import useSWR from "swr";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { HeroLyrics, HeroLyricsSkeleton } from "@/components/live/hero-lyrics";
import { ListeningHero, type Hero } from "@/components/live/listening/hero";
import { paletteGradient } from "@/components/live/listening/now-playing";
import { RecentTracks, dedupeListeningItems } from "@/components/live/listening/recent-tracks";
import { UpNext } from "@/components/live/listening/up-next";
import { useElsewhere } from "@/components/live/listening/use-elsewhere";
import { PlayerArtworkPreload } from "@/components/web-player/player-artwork";
import { useWebPlayer } from "@/components/web-player/web-player-provider";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useLyrics, type LyricsFallback } from "@/hooks/use-lyrics";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useLiveNowListening } from "@/hooks/use-stale";
import { useExpiryRefetch, useStatus } from "@/hooks/use-status";
import { stableKeys } from "@/lib/keys";
import { LISTENING_PATH, NOW_LISTENING_PATH } from "@/lib/paths";
import { trackEnded } from "@/lib/track-position";
import type {
  ListeningItem,
  ListeningPayload,
  LocalNowPlaying,
  NowListeningPayload,
  StatusResponse,
  TrackMotion,
} from "@shared/types";
import type { ArtworkPlaceholders } from "@/lib/artwork-placeholder";
import { liveTrack } from "@shared/home-layout";
import { fetchCatalogSongAlbum, queueOptionsFor } from "@/lib/web-player";
import { cn } from "@/lib/utils";

const REFRESH_MS = 10 * 60_000;
const EMPTY_UPCOMING: string[] = [];
const EMPTY_REFRESH_MS = 60_000;
const MUSIC_REFRESH_MS = 60_000;

export function ListeningCard({
  fallback,
  nowFallback,
  lyricsFallback,
  artworkPlaceholders,
  className,
  wide = false,
}: {
  fallback: StatusResponse<ListeningPayload>;
  nowFallback: StatusResponse<NowListeningPayload>;
  lyricsFallback?: LyricsFallback | null;
  artworkPlaceholders: ArtworkPlaceholders;
  className?: string;
  wide?: boolean;
}) {
  const { data, error, isLoading } = useStatus<ListeningPayload>(
    LISTENING_PATH,
    (current) => (current ? REFRESH_MS : EMPTY_REFRESH_MS),
    { fallback },
  );
  useLiveEvents();
  const player = useWebPlayer();
  const {
    data: nowListening,
    error: nowError,
    isValidating: nowValidating,
    servedAt: nowServedAt,
  } = useStatus<NowListeningPayload>(
    NOW_LISTENING_PATH,
    MUSIC_REFRESH_MS,
    { fallback: nowFallback },
  );
  const live = useLiveNowListening(nowListening, {
    validating: nowValidating,
    servedAt: nowServedAt,
  });
  // 暂停宽限期到期不对应上报或推送，必须定时重新请求来源选择。
  useExpiryRefetch(NOW_LISTENING_PATH, live?.expiresInMs);

  const reduced = useReducedMotion();

  const localMusic = live?.idle ? null : live?.music ?? null;
  const localTrack = liveTrack(localMusic);
  const localActive = Boolean(localTrack);

  const fallbackNow = nowFallback.ok ? nowFallback.data : undefined;
  const [nowRefresh, setNowRefresh] = useState<"pending" | "fetching" | "done">("pending");
  if (nowRefresh !== "done") {
    if (nowListening !== fallbackNow) setNowRefresh("done");
    else if (nowRefresh === "fetching" && !nowValidating) setNowRefresh(nowError ? "pending" : "done");
    else if (nowRefresh === "pending" && nowValidating) setNowRefresh("fetching");
  }

  const mountedAt = useMountedAt();
  // 首屏快照里的歌按此刻的钟已经放完，说明快照旧了：在头一次回源确认前停在首屏画的锚点上，
  // 否则水合后进度先拉满、歌词先跳到尾，新歌到了再换一次。观测时刻推到无穷远，进度就不随钟走。
  const heldTrack: LocalNowPlaying | null =
    localTrack && nowRefresh !== "done" && mountedAt > 0 && trackEnded(localTrack, mountedAt)
      ? { ...localTrack, observedAt: Number.POSITIVE_INFINITY }
      : localTrack;
  const elsewhere = useElsewhere(live, localActive, mountedAt);

  // 目录查询失败不代表停播；同一曲目保留解析结果，换曲后禁止沿用。
  const trackKey = localTrack
    ? `${localTrack.title ?? ""}|${localTrack.artist ?? ""}|${localTrack.album ?? ""}`
    : null;
  const [lookupLatch, setLookupLatch] = useState<{
    key: string;
    id: string | null;
    songId: string;
    link: string | null;
    upcomingSongIds: string[];
    hasLyrics: boolean;
    motion: TrackMotion | null;
  } | null>(null);
  if (
    live?.songId &&
    trackKey &&
    (lookupLatch?.key !== trackKey || lookupLatch.songId !== live.songId)
  ) {
    setLookupLatch({
      key: trackKey,
      id: live.id,
      songId: live.songId,
      link: live.link,
      upcomingSongIds: live.upcomingSongIds,
      hasLyrics: live.hasLyrics,
      motion: live.motion,
    });
  }
  const latched = trackKey && lookupLatch?.key === trackKey ? lookupLatch : null;
  const resolvedSongId = live?.songId ?? latched?.songId ?? null;
  const resolvedUpcoming = useMemo(
    () => live?.songId ? live.upcomingSongIds : latched?.upcomingSongIds ?? EMPTY_UPCOMING,
    [live?.songId, live?.upcomingSongIds, latched?.upcomingSongIds],
  );
  const resolvedHasLyrics = live?.songId ? live.hasLyrics : latched?.hasLyrics ?? false;

  const { lyrics, songwriters, isLoading: lyricsLoading } = useLyrics(
    resolvedSongId,
    resolvedHasLyrics,
    lyricsFallback,
  );

  const showSideLyrics = Boolean(
    wide &&
      localActive &&
      (Boolean(lyrics && lyrics.length > 0) || (lyricsLoading && resolvedHasLyrics)),
  );

  const upNext = !localActive ? elsewhere?.next ?? null : null;
  const showSideNext = Boolean(wide && upNext);

  const isResolvingTrack = localActive && resolvedSongId == null;
  const showMobileLyrics = Boolean(
    localActive &&
      (Boolean(lyrics && lyrics.length > 0) ||
        (lyricsLoading && resolvedHasLyrics) ||
        isResolvingTrack),
  );

  const setSyncSource = player?.setSyncSource;
  useEffect(() => {
    setSyncSource?.({
      track: localTrack,
      songId: resolvedSongId,
      upcomingSongIds: resolvedUpcoming,
    });
  }, [setSyncSource, localTrack, resolvedSongId, resolvedUpcoming]);
  useEffect(() => () => {
    setSyncSource?.({ track: null, songId: null });
  }, [setSyncSource]);

  const openInPlayer = useCallback(
    (item: ListeningItem) => player?.openWith(item),
    [player],
  );
  const canOpenInPlayer = (item: ListeningItem) =>
    Boolean(player && player.status !== "unavailable" && queueOptionsFor(item));

  const [latest, ...tail] = data?.items ?? [];

  const hero: Hero | null = localActive
    ? {
        key: `${localTrack!.source}:${localTrack!.trackId ?? localTrack!.title}`,
        artwork: localTrack!.artworkUrl,
        title: localTrack!.title ?? "",
        subtitle: localTrack!.artist ?? "",
        link: live?.link ?? latched?.link ?? null,
        label:
          localTrack!.state === "playing"
            ? localTrack!.repeatOne
              ? "Repeat One"
              : "Now Playing"
            : "Paused",
        playing: localTrack!.state === "playing",
        palette:
          data?.items.find((item) => item.id === live?.id)?.palette ?? [],
        durationMs: null,
        track: heldTrack,
        motion: live?.songId ? live.motion : latched?.motion ?? null,
      }
    : elsewhere
      ? {
          key: `elsewhere:${elsewhere.songId ?? elsewhere.title}`,
          artwork: elsewhere.artworkUrl,
          title: elsewhere.title,
          subtitle: elsewhere.artist ?? "",
          link: null,
          label: "Likely Playing",
          playing: true,
          palette: [],
          durationMs: null,
          track: {
            source: "apple-music",
            state: "playing",
            title: elsewhere.title,
            artist: elsewhere.artist,
            album: elsewhere.album,
            trackId: null,
            artworkUrl: elsewhere.artworkUrl,
            positionMs: 0,
            durationMs: elsewhere.durationMs,
            repeatOne: false,
            observedAt: elsewhere.startedAt,
          },
          motion: null,
          estimatedMarginMs: elsewhere.marginMs,
          predictedBasis: elsewhere.basis,
        }
    : latest
      ? {
          key: latest.id,
          artwork: latest.artwork,
          title: latest.title,
          subtitle: latest.artist,
          link: latest.link,
          label: "Last Played",
          playing: false,
          palette: latest.palette,
          durationMs: latest.durationMs,
          track: null,
          motion: latest.motion ?? null,
        }
      : null;

  const heroResourceId = live?.id ?? latched?.id ?? null;
  // 推断播放只有单曲 ID，所属专辑要另查目录才能像本机在播一样打开。
  const elsewhereSongId =
    !localActive && player && player.status !== "unavailable" ? elsewhere?.songId ?? null : null;
  const { data: elsewhereAlbum } = useSWR(
    elsewhereSongId ? ["catalog-song-album", elsewhereSongId] : null,
    ([, songId]) => fetchCatalogSongAlbum(songId),
    { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  );
  const heroItem: ListeningItem | null | undefined = localActive && hero?.track
    ? data?.items.find((item) => item.id === heroResourceId) ??
      (heroResourceId && hero.link ? {
        id: heroResourceId,
        title: hero.track.album || hero.title,
        artist: hero.subtitle,
        artwork: hero.artwork,
        link: hero.link,
        palette: hero.palette,
        durationMs: null,
      } : null)
    : elsewhere
      ? elsewhereAlbum
        ? data?.items.find((item) => item.id === elsewhereAlbum.id) ?? elsewhereAlbum
        : null
      : latest;
  const canOpenHero = Boolean(heroItem && canOpenInPlayer(heroItem));

  const rest = dedupeListeningItems(
    localActive || elsewhere ? (data?.items ?? []) : tail,
    localActive ? (live?.id ?? null) : null,
  );
  const restKeys = stableKeys(rest.map((item) => item.id));
  const preloadArtworks = Array.from(
    new Set(
      [heroItem, ...rest].flatMap((entry) =>
        entry?.artwork && canOpenInPlayer(entry) ? [entry.artwork] : [],
      ),
    ),
  );

  const motionData = hero?.motion ?? null;
  const motionGradient =
    motionData?.colors && motionData.colors.length >= 2
      ? paletteGradient(motionData.colors)
      : undefined;

  return (
    <Card
      label="Recently Played"
      action="Apple Music"
      className={cn("h-full min-h-93.5", className)}
    >
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3 lg:px-5 lg:pb-5">
        <ListeningHero
          hero={hero}
          isLoading={isLoading}
          error={error}
          reduced={reduced}
          showSideLyrics={showSideLyrics}
          showSideNext={showSideNext}
          upNext={upNext}
          canOpenHero={canOpenHero}
          heroItem={heroItem}
          openInPlayer={openInPlayer}
          artworkPlaceholders={artworkPlaceholders}
          motionData={motionData}
          motionGradient={motionGradient}
          lyrics={lyrics}
          songwriters={songwriters}
        />

        <AnimatePresence initial={false}>
          {showMobileLyrics && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 0.25, ease: "easeInOut" }
              }
              className="overflow-hidden md:hidden"
            >
              <div className="mt-3 min-w-0 border-t border-line/60 pt-2.5">
                {lyrics && hero?.track ? (
                  <HeroLyrics
                    lyrics={lyrics}
                    track={hero.track}
                    songwriters={songwriters}
                    reduced={Boolean(reduced)}
                  />
                ) : (
                  <HeroLyricsSkeleton />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {upNext && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 0.25, ease: "easeInOut" }
              }
              className={cn("overflow-hidden", showSideNext && "md:hidden")}
            >
              <div className="mt-3 min-w-0 border-t border-line/60 pt-2.5">
                <UpNext next={upNext} inline />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <RecentTracks
          rest={rest}
          restKeys={restKeys}
          wide={wide}
          reduced={reduced}
          isLoading={isLoading}
          artworkPlaceholders={artworkPlaceholders}
          canOpenInPlayer={canOpenInPlayer}
          openInPlayer={openInPlayer}
        />
      </div>
      <PlayerArtworkPreload artworks={preloadArtworks} />
    </Card>
  );
}
