"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSWRConfig } from "swr";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import Image from "@/components/app-image";
import { Card } from "@/components/ui/card";
import { HomePodMiniIcon, MacBookProIcon } from "@/components/ui/device-icons";
import {
  HeroLyrics,
  HeroLyricsSkeleton,
  LYRIC_LINE_VARIANTS,
  LyricWords,
} from "@/components/live/hero-lyrics";
import { HeroMotionArtwork } from "@/components/live/hero-motion-artwork";
import { PlayerArtworkPreload } from "@/components/web-player/player-artwork";
import { useWebPlayer } from "@/components/web-player/web-player-provider";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useLyrics, type LyricsFallback } from "@/hooks/use-lyrics";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useLiveNowListening } from "@/hooks/use-stale";
import { useExpiryRefetch, useStatus } from "@/hooks/use-status";
import { stableKeys } from "@/lib/keys";
import { LISTENING_ELSEWHERE_HOLD_MS } from "@/lib/limits";
import { cueAt, NO_CUE } from "@/lib/lyrics-cue";
import type { LyricLine } from "@/lib/lyrics-ttml";
import {
  HERO_VARIANTS,
  LIST_DURATION,
  LIST_ITEM_VARIANTS,
  LIST_TRANSITION,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import { LISTENING_PATH, NOW_LISTENING_PATH } from "@/lib/paths";
import { trackPositionMs } from "@/lib/track-position";
import type {
  ListeningItem,
  ListeningPayload,
  LocalNowPlaying,
  NowListeningElsewhere,
  NowListeningNext,
  NowListeningPayload,
  StatusResponse,
  TrackMotion,
} from "@/lib/types";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing } from "@/lib/apple-artwork";
import type { ArtworkDataUri, ArtworkPlaceholders } from "@/lib/artwork-placeholder";
import { liveTrack } from "@/lib/home-layout";
import { queueOptionsFor } from "@/lib/web-player";
import { cn } from "@/lib/utils";

const REFRESH_MS = 10 * 60_000;
const EMPTY_UPCOMING: string[] = [];
const EMPTY_REFRESH_MS = 60_000;
const MUSIC_REFRESH_MS = 60_000;

// VISIBLE_ROWS × 2 须与 globals.css 的 recent-tracks-track nth-child 上限对齐。
const VISIBLE_ROWS = 4;
const MIN_ROW_HEIGHT_PX = 56;

function formatDuration(milliseconds: number) {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

function formatMargin(milliseconds: number) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  return seconds < 90 ? `±${seconds}s` : `±${Math.round(seconds / 60)}m`;
}

function paletteGradient(palette: string[]): string | undefined {
  if (palette.length < 2) return undefined;
  const stops = [...palette, palette[0]]
    .map((color) => (color.startsWith("#") ? color : `#${color}`))
    .map((color) => `oklch(from ${color} 0.74 max(c, 0.09) h)`)
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

// 两层动画必须从挂载时同步起步；条件挂载会让渐变交叉淡入时错相。
function PaletteBar({
  base,
  motion: motionGradient,
  idleClassName,
  className,
  style,
}: {
  base?: string;
  motion?: string;
  idleClassName?: string;
  className?: string;
  style?: CSSProperties;
}) {
  // motion 清空时保留上一套背景，避免淡出过程中露出 CSS 默认彩虹。
  const rememberMotionGradient = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && motionGradient) node.style.backgroundImage = motionGradient;
    },
    [motionGradient],
  );

  return (
    <div className={cn("relative", className)} style={style} aria-hidden>
      <div
        className={cn("absolute inset-0", base ? "rainbow-bar" : idleClassName)}
        style={{ backgroundImage: base }}
      />
      <div
        ref={rememberMotionGradient}
        className={cn(
          "rainbow-bar absolute inset-0 transition-opacity ease-out",
          motionGradient ? "opacity-100 duration-700" : "opacity-0 duration-0",
        )}
      />
    </div>
  );
}

// 换歌会重挂 hero；按墙钟设相位才能与离场实例衔接。
const BAR_PERIODS = [0.9, 1.15, 1.4];

type BarsState = "playing" | "paused" | "idle";

function Bars({ state }: { state: BarsState }) {
  const idleHeights = ["h-2", "h-3", "h-1.5"];
  const animated = state !== "idle";

  const alignPhase = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!node || !animated) return;
      const seconds = Date.now() / 1000;
      [...node.children].forEach((child, i) => {
        const period = BAR_PERIODS[i];
        (child as HTMLElement).style.animationDelay =
          `${(-((seconds % period) + i * 0.15)).toFixed(3)}s`;
      });
    },
    [animated],
  );

  return (
    <span className="flex h-3 items-end gap-0.5" aria-hidden ref={alignPhase}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-0.5 origin-bottom",
            state === "idle"
              ? `bg-muted-foreground ${idleHeights[i]}`
              : state === "playing"
                ? "h-full bg-live"
                : "h-full bg-muted-foreground",
          )}
          style={
            animated
              ? {
                  animation: `equalizer ${BAR_PERIODS[i]}s ease-in-out infinite`,
                  animationPlayState: state === "paused" ? "paused" : "running",
                }
              : undefined
          }
        />
      ))}
    </span>
  );
}

function Clock({ milliseconds }: { milliseconds: number }) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return (
    <>
      <NumberFlow value={Math.floor(seconds / 60)} locales="en-US" />
      <span>:</span>
      <NumberFlow
        value={seconds % 60}
        locales="en-US"
        format={{ minimumIntegerDigits: 2 }}
      />
    </>
  );
}

function HeroProgress({
  track,
  subtitle,
  palette,
  motionGradient,
  lyrics,
  sideLyrics = false,
}: {
  track: LocalNowPlaying;
  subtitle: string;
  palette?: string[];
  motionGradient?: string;
  lyrics: LyricLine[] | null;
  sideLyrics?: boolean;
}) {
  const playing = track.state === "playing";
  const reduced = useReducedMotion();
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setTicked(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [playing]);

  const position = trackPositionMs(track, now);
  const percent = track.durationMs ? (position / track.durationMs) * 100 : 0;
  const gradient = palette && palette.length >= 2 ? paletteGradient(palette) : undefined;

  const { observedAt, positionMs, durationMs, repeatOne } = track;
  useEffect(() => {
    if (!playing || !lyrics) return;
    const anchor = { state: "playing" as const, observedAt, positionMs, durationMs, repeatOne };
    const at = trackPositionMs(anchor, Math.max(now, Date.now()));
    const { until } = cueAt(lyrics, at);
    const target = until ?? (repeatOne && durationMs > 0 ? durationMs : null);
    if (target == null) return;
    const timer = window.setTimeout(() => setTicked(Date.now()), Math.max(16, target - at + 8));
    return () => window.clearTimeout(timer);
  }, [playing, lyrics, now, observedAt, positionMs, durationMs, repeatOne]);

  const cue = lyrics ? cueAt(lyrics, position) : NO_CUE;
  const current = cue.index >= 0 ? lyrics![cue.index] : null;
  const line = current?.text ?? null;

  return (
    <>
      <div className="mt-px flex items-baseline gap-2 text-sm text-muted-foreground">
        {/* 副歌可能重复同一句文字，key 用歌词下标才能触发第二次换句。 */}
        <span
          className="relative min-w-0 flex-1 overflow-hidden"
          title={sideLyrics ? subtitle : (line ?? subtitle)}
        >
          {sideLyrics ? (
            <span className="block truncate">{subtitle}</span>
          ) : (
            <>
              <span className="hidden md:block">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={cue.index}
                    className={cn("block truncate", line != null && "text-foreground")}
                    variants={reduced ? STATIC_VARIANTS : LYRIC_LINE_VARIANTS}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    {current?.words ? (
                      <LyricWords words={current.words} track={track} />
                    ) : (
                      (line ?? subtitle)
                    )}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="block truncate md:hidden">{subtitle}</span>
            </>
          )}
        </span>
        <NumberFlowGroup>
          <span className="label-mono shrink-0 tabular-nums">
            <Clock milliseconds={position} />
            <span> / </span>
            <Clock milliseconds={track.durationMs} />
          </span>
        </NumberFlowGroup>
      </div>
      <div className="mt-1.5 h-0.75 overflow-hidden bg-muted">
        <PaletteBar
          className="h-full transition-[width] duration-700 ease-linear"
          base={playing ? gradient : undefined}
          motion={playing ? motionGradient : undefined}
          idleClassName={playing ? "bg-live" : "bg-muted-foreground"}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </>
  );
}

function TrackRow({
  track,
  placeholder,
  onOpen,
}: {
  track: ListeningItem;
  placeholder: ArtworkDataUri | undefined;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <div className="relative size-11 shrink-0 overflow-hidden rounded-sm border border-line bg-muted">
        {placeholder && (
          <Image
            src={placeholder}
            alt=""
            aria-hidden
            fill
            sizes="44px"
            className="object-cover"
            decoding="sync"
          />
        )}
        {track.artwork && (
          <Image
            src={appleArtwork(track.artwork, 44 * ARTWORK_SCALE)!}
            alt=""
            fill
            sizes="44px"
            className="object-cover"
            unoptimized={!needsOptimizing(track.artwork)}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {track.artist}
        </div>
      </div>
    </>
  );

  const className =
    "flex h-full items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-surface-hover";

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(className, "w-full text-left")}
      >
        {content}
      </button>
    );
  }

  return track.link ? (
    <a
      href={track.link}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function dedupeListeningItems(items: ListeningItem[], currentId: string | null) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (currentId && item.id === currentId) return false;
    if (!item.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function SkeletonRow() {
  return (
    <div className="flex h-full items-center gap-2.5 px-2">
      <div className="size-11 shrink-0 animate-pulse rounded-sm bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const UNSNAP_MS = LIST_DURATION * 1000 + 80;

function resetScroller(el: HTMLElement) {
  const saved = el.style.scrollBehavior;
  el.style.scrollBehavior = "auto";
  el.scrollTop = 0;
  el.scrollLeft = 0;
  el.style.scrollBehavior = saved;
}

function useRowSnap(topKey: string | undefined, wide: boolean) {
  const node = useRef<HTMLDivElement | null>(null);
  const previous = useRef(topKey);

  useIsomorphicLayoutEffect(() => {
    if (previous.current === topKey) return;
    previous.current = topKey;
    const el = node.current;
    if (!el || (el.scrollTop === 0 && el.scrollLeft === 0)) return;
    resetScroller(el);
  }, [topKey]);

  useIsomorphicLayoutEffect(() => {
    if (!node.current) return;
    resetScroller(node.current);
  }, [wide]);

  return useCallback((el: HTMLDivElement | null) => {
    node.current = el;
  }, []);
}

const NEXT_BASIS = {
  loop: { label: "Loop", hint: "Guessed from the last few songs repeating in the same order" },
  order: { label: "In Order", hint: "Guessed from where it is in the playlist or album" },
} as const;

function NextBadge({ basis, className }: { basis: NowListeningNext["basis"]; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-sm border border-dashed border-line px-1.5 py-px text-[10px] leading-4 text-muted-foreground", className)}
      title={NEXT_BASIS[basis].hint}
    >
      {NEXT_BASIS[basis].label}
    </span>
  );
}

function UpNext({ next, inline = false }: { next: NowListeningNext; inline?: boolean }) {
  if (inline) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="label-mono shrink-0 text-muted-foreground">Up Next</span>
        <span className="min-w-0 flex-1 truncate" title={next.artist ? `${next.title} · ${next.artist}` : next.title}>
          <span className="font-medium">{next.title}</span>
          {next.artist && <span className="text-muted-foreground"> · {next.artist}</span>}
        </span>
        <NextBadge basis={next.basis} />
      </div>
    );
  }
  return (
    <div className="flex h-20 min-w-0 flex-col justify-center">
      <div className="flex min-h-5 items-center gap-1.5">
        <span className="label-mono text-muted-foreground">Up Next</span>
        <NextBadge basis={next.basis} />
      </div>
      <div className="mt-1 truncate font-medium leading-snug" title={next.title}>
        {next.title}
      </div>
      {next.artist && (
        <div className="mt-px truncate text-sm text-muted-foreground" title={next.artist}>
          {next.artist}
        </div>
      )}
    </div>
  );
}

function HeroWrapper({
  link,
  wideLyrics = false,
  onOpen,
  children,
}: {
  link: string | null;
  wideLyrics?: boolean;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const className = cn(
    "group h-full rounded-md",
    wideLyrics ? "flex gap-3 md:grid md:grid-cols-2 md:gap-0" : "flex gap-3",
  );
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(className, "w-full text-left")}
      >
        {children}
      </button>
    );
  }
  return link ? (
    <a
      href={link}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
    >
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

type Hero = {
  key: string;
  artwork: string | null;
  title: string;
  subtitle: string;
  link: string | null;
  label: string;
  playing: boolean;
  palette: string[];
  durationMs: number | null;
  track: LocalNowPlaying | null;
  motion: TrackMotion | null;
  estimatedMarginMs?: number;
  predictedBasis?: NowListeningNext["basis"];
};

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

  // 推断的别处播放没有上报来续命：和源站一样按时长放完再留 LISTENING_ELSEWHERE_HOLD_MS 等下一首被推过来，到点就撤下并重新取一次。
  const mountedAt = useMountedAt();
  const [elsewhereTick, setElsewhereTick] = useState(0);
  const { mutate } = useSWRConfig();
  const inferred = live?.elsewhere ?? null;
  const inferredEnd = inferred ? inferred.startedAt + inferred.durationMs : null;
  const inferredUntil = inferredEnd == null ? null : inferredEnd + LISTENING_ELSEWHERE_HOLD_MS;
  const handoffAt = inferred?.next?.durationMs ? inferredEnd : null;
  useEffect(() => {
    if (inferredUntil == null) return;
    const timer = window.setTimeout(() => {
      setElsewhereTick(Date.now());
      void mutate(NOW_LISTENING_PATH);
    }, Math.max(250, inferredUntil - Date.now() + 250));
    return () => window.clearTimeout(timer);
  }, [inferredUntil, mutate]);
  useEffect(() => {
    if (handoffAt == null) return;
    const timer = window.setTimeout(() => setElsewhereTick(Date.now()), Math.max(0, handoffAt - Date.now() + 50));
    return () => window.clearTimeout(timer);
  }, [handoffAt]);
  const clock = Math.max(elsewhereTick, mountedAt);
  const shownElsewhere = !localActive && inferred && clock > 0 && clock < inferredUntil! ? inferred : null;
  // 放完到下一首被看见之间先换成猜的那首；key 与确认后的同一首一致，确认时 Hero 不重播入场动画。
  const predicted = shownElsewhere?.next?.durationMs && clock >= inferredEnd! ? shownElsewhere.next : null;
  const elsewhere: (NowListeningElsewhere & { basis?: NowListeningNext["basis"] }) | null = shownElsewhere && predicted
    ? {
        title: predicted.title,
        artist: predicted.artist,
        album: null,
        artworkUrl: predicted.artworkUrl,
        songId: predicted.songId,
        startedAt: inferredEnd!,
        durationMs: predicted.durationMs!,
        marginMs: shownElsewhere.marginMs,
        next: predicted.then ?? null,
        basis: predicted.basis,
      }
    : shownElsewhere;

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
        track: localTrack,
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
  const heroItem: ListeningItem | null | undefined = hero?.track
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
  const listRef = useRowSnap(restKeys[0], wide);

  // popLayout 改变离场行定位，动画期间须关闭 scroll-snap，防止吸附目标跳动。
  const ids = restKeys.join("\n");
  const [snappedIds, setSnappedIds] = useState(ids);
  const [reflowing, setReflowing] = useState(false);
  if (snappedIds !== ids) {
    setSnappedIds(ids);
    setReflowing(true);
  }
  useEffect(() => {
    if (!reflowing) return;
    const timer = setTimeout(() => setReflowing(false), UNSNAP_MS);
    return () => clearTimeout(timer);
  }, [reflowing, ids]);

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
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        <div className="relative h-20 shrink-0">
          {!hero ? (
            <HeroWrapper link={null}>
              <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-md border border-line bg-muted" />
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <div className="text-sm text-muted-foreground">
                  {isLoading
                    ? "Loading…"
                    : error
                      ? "Apple Music not connected"
                      : "Nothing played recently"}
                </div>
              </div>
            </HeroWrapper>
          ) : (
            <AnimatePresence initial={false}>
              <motion.div
                key={hero.key}
                className="absolute inset-0"
                variants={reduced ? STATIC_VARIANTS : HERO_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                // 统一 transition 会覆盖 variant 中的非对称时长。
                transition={reduced ? STATIC_TRANSITION : undefined}
              >
                <HeroWrapper
                  link={hero.track ? null : hero.link}
                  wideLyrics={showSideLyrics || showSideNext}
                  onOpen={
                    canOpenHero && heroItem
                      ? () => openInPlayer(heroItem)
                      : undefined
                  }
                >
                  <div className={cn("flex min-w-0 flex-1 gap-3", (showSideLyrics || showSideNext) && "md:pr-5")}>
                    <HeroMotionArtwork
                      artwork={hero.artwork}
                      placeholder={
                        hero.artwork ? artworkPlaceholders.hero[hero.artwork] : undefined
                      }
                      title={hero.title}
                      videoUrl={motionData?.videoUrl ?? null}
                      reduced={Boolean(reduced)}
                    />

                    <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
                      <div className="flex min-h-5 min-w-0 items-center gap-1.5">
                        <Bars
                          state={
                            hero.playing ? "playing" : hero.track ? "paused" : "idle"
                          }
                        />
                        <span
                          className={cn(
                            "label-mono shrink-0",
                            hero.playing ? "text-live" : "text-muted-foreground",
                          )}
                        >
                          {hero.label}
                        </span>
                        {hero.track && hero.predictedBasis ? (
                          <NextBadge basis={hero.predictedBasis} className="ml-0.5" />
                        ) : hero.track && hero.estimatedMarginMs != null ? (
                          <span
                            className="ml-0.5 inline-flex min-w-0 items-center rounded-sm border border-dashed border-line px-1.5 py-px text-[10px] leading-4 tabular-nums text-muted-foreground"
                            title={`Estimated from Apple Music's recently played list and track lengths; ideal start error ${formatMargin(hero.estimatedMarginMs)}`}
                          >
                            <span className="sr-only">Estimated, ideal start error </span>
                            <span className="truncate">{formatMargin(hero.estimatedMarginMs)}</span>
                          </span>
                        ) : hero.track && (
                          <span className="ml-0.5 inline-flex min-w-0 items-center gap-1 rounded-sm border border-line px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
                            {hero.track.source === "homepod" ? (
                              <HomePodMiniIcon className="size-3 shrink-0" aria-hidden />
                            ) : (
                              <MacBookProIcon className="size-3 shrink-0" aria-hidden />
                            )}
                            <span className="truncate">
                              {hero.track.source === "homepod" ? "HomePod mini" : "MacBook Pro"}
                            </span>
                          </span>
                        )}
                      </div>
                      <div
                        className={cn(
                          "mt-1 truncate font-medium leading-snug",
                          (canOpenHero || (!hero.track && hero.link)) && "group-hover:underline",
                        )}
                        title={hero.title}
                      >
                        {hero.title}
                      </div>
                      {hero.track ? (
                        <HeroProgress
                          track={hero.track}
                          subtitle={hero.subtitle}
                          palette={hero.palette}
                          motionGradient={motionGradient}
                          lyrics={hero.estimatedMarginMs != null ? null : lyrics}
                          sideLyrics={showSideLyrics}
                        />
                      ) : (
                        <>
                          <div className="mt-px flex items-baseline gap-2 text-sm text-muted-foreground">
                            <span className="min-w-0 flex-1 truncate" title={hero.subtitle}>
                              {hero.subtitle}
                            </span>
                            {hero.durationMs != null && (
                              <span className="label-mono shrink-0 tabular-nums">
                                {formatDuration(hero.durationMs)}
                              </span>
                            )}
                          </div>
                          <PaletteBar
                            className="mt-1.5 h-0.75"
                            base={paletteGradient(hero.palette)}
                            motion={motionGradient}
                            idleClassName="rainbow-bar"
                          />
                        </>
                      )}
                    </div>
                  </div>

                  {showSideNext && upNext && (
                    <div className="hidden min-w-0 border-l border-line pl-5 md:flex md:flex-col md:justify-center overflow-hidden">
                      <UpNext next={upNext} />
                    </div>
                  )}

                  {showSideLyrics && (
                    <div className="hidden min-w-0 border-l border-line pl-5 md:flex md:flex-col md:justify-center overflow-hidden">
                      {lyrics ? (
                        <HeroLyrics
                          lyrics={lyrics}
                          track={hero.track!}
                          songwriters={songwriters}
                          reduced={Boolean(reduced)}
                        />
                      ) : (
                        <HeroLyricsSkeleton />
                      )}
                    </div>
                  )}
                </HeroWrapper>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

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

        {/* 空列表也须保留视口，否则客户端补数据时会撑高整行。 */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-line pt-2">
          {/* 滚动内容不能参与网格的固有高度计算，否则整份列表会撑高卡片。 */}
          <div
            className="relative min-h-0 flex-1"
            style={
              {
                minHeight: `${MIN_ROW_HEIGHT_PX * VISIBLE_ROWS}px`,
                "--recent-track-rows": VISIBLE_ROWS,
              } as CSSProperties
            }
          >
            <div
              ref={listRef}
              // Firefox / 部分 Safari 的滚动容器需要 tabindex 才能获得键盘焦点。
              tabIndex={0}
              role="region"
              aria-label="Recently played"
              className={cn(
                "absolute inset-0",
                "recent-tracks",
                wide && "is-wide",
                reflowing && "is-reflowing",
                "scroll-smooth",
                // 新条目插到顶部时，滚动锚定会自动推走第一行，因此关闭它。
                "[overflow-anchor:none]",
                "scrollbar-none [&::-webkit-scrollbar]:hidden",
              )}
            >
              <div className="recent-tracks-track">
                {rest.length > 0 ? (
                  <AnimatePresence initial={false} mode="popLayout">
                    {rest.map((item, index) => (
                      <motion.div
                        key={restKeys[index]}
                        layout={!reduced}
                        variants={reduced ? STATIC_VARIANTS : LIST_ITEM_VARIANTS}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
                        className={cn("min-w-0", index % VISIBLE_ROWS === 0 && "snap-start")}
                      >
                        <TrackRow
                          track={item}
                          placeholder={
                            item.artwork
                              ? artworkPlaceholders.rows[item.artwork]
                              : undefined
                          }
                          onOpen={canOpenInPlayer(item) ? () => openInPlayer(item) : undefined}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                ) : isLoading ? (
                  Array.from({ length: VISIBLE_ROWS }, (_, i) => (
                    <SkeletonRow key={i} />
                  ))
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      <PlayerArtworkPreload artworks={preloadArtworks} />
    </Card>
  );
}
