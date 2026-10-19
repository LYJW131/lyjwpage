"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { HomePodMiniIcon, MacBookProIcon } from "@/components/ui/device-icons";
import { HeroLyrics, HeroLyricsSkeleton } from "@/components/live/hero-lyrics";
import { HeroMotionArtwork } from "@/components/live/hero-motion-artwork";
import { Bars, HeroProgress, PaletteBar, formatDuration, formatMargin, paletteGradient } from "@/components/live/listening/now-playing";
import { NextBadge, UpNext } from "@/components/live/listening/up-next";
import type { useLyrics } from "@/hooks/use-lyrics";
import { HERO_VARIANTS, STATIC_TRANSITION, STATIC_VARIANTS } from "@/lib/motion";
import type { ListeningItem, LocalNowPlaying, NowListeningNext, TrackMotion } from "@shared/types";
import type { ArtworkPlaceholders } from "@/lib/artwork-placeholder";
import { cn } from "@/lib/utils";

function HeroAction({
  link,
  onOpen,
  ariaLabel,
  className,
  children,
}: {
  link: string | null;
  onOpen?: () => void;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        className={cn("cursor-pointer text-left", className)}
      >
        {children}
      </button>
    );
  }
  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </a>
    );
  }
  return <div className={className}>{children}</div>;
}
export type Hero = {
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

type Lyrics = ReturnType<typeof useLyrics>;

export function ListeningHero({
  hero,
  isLoading,
  error,
  reduced,
  showSideLyrics,
  showSideNext,
  upNext,
  canOpenHero,
  heroItem,
  openInPlayer,
  artworkPlaceholders,
  motionData,
  motionGradient,
  lyrics,
  songwriters,
}: {
  hero: Hero | null;
  isLoading: boolean;
  error: unknown;
  reduced: boolean | null;
  showSideLyrics: boolean;
  showSideNext: boolean;
  upNext: NowListeningNext | null;
  canOpenHero: boolean;
  heroItem: ListeningItem | null | undefined;
  openInPlayer: (item: ListeningItem) => void;
  artworkPlaceholders: ArtworkPlaceholders;
  motionData: TrackMotion | null;
  motionGradient: string | undefined;
  lyrics: Lyrics["lyrics"];
  songwriters: Lyrics["songwriters"];
}) {
  return (
    <div className="relative h-20 shrink-0">
      {!hero ? (
        <div className="flex h-full gap-3 rounded-md">
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
        </div>
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
            <div
              className={cn(
                "h-full rounded-md",
                showSideLyrics || showSideNext
                  ? "flex gap-3 md:grid md:grid-cols-2 md:gap-0"
                  : "flex gap-3",
              )}
            >
              <div className={cn("flex min-w-0 flex-1 gap-3", (showSideLyrics || showSideNext) && "md:pr-5")}>
                <HeroAction
                  link={hero.track ? null : hero.link}
                  onOpen={
                    canOpenHero && heroItem
                      ? () => openInPlayer(heroItem)
                      : undefined
                  }
                  ariaLabel={hero.title}
                  className="group shrink-0 rounded-md"
                >
                  <HeroMotionArtwork
                    artwork={hero.artwork}
                    placeholder={
                      hero.artwork ? artworkPlaceholders.hero[hero.artwork] : undefined
                    }
                    title={hero.title}
                    videoUrl={motionData?.videoUrl ?? null}
                    reduced={Boolean(reduced)}
                  />
                </HeroAction>

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
                        hero.playing ? "text-live-ink" : "text-muted-foreground",
                      )}
                    >
                      {hero.label}
                    </span>
                    {hero.track && hero.predictedBasis ? (
                      <NextBadge basis={hero.predictedBasis} className="ml-0.5" />
                    ) : hero.track && hero.estimatedMarginMs != null ? (
                      <span
                        className="ml-0.5 inline-flex min-w-0 items-center rounded-sm border border-dashed border-line px-1.5 py-px text-2xs leading-4 tabular-nums text-muted-foreground"
                        title={`Estimated from Apple Music's recently played list and track lengths; ideal start error ${formatMargin(hero.estimatedMarginMs)}`}
                      >
                        <span className="sr-only">Estimated, ideal start error </span>
                        <span className="truncate">{formatMargin(hero.estimatedMarginMs)}</span>
                      </span>
                    ) : hero.track && (
                      <span className="ml-0.5 inline-flex min-w-0 items-center gap-1 rounded-sm border border-line px-1.5 py-px text-2xs leading-4 text-muted-foreground">
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
                  <HeroAction
                    link={hero.track ? null : hero.link}
                    onOpen={
                      canOpenHero && heroItem
                        ? () => openInPlayer(heroItem)
                        : undefined
                    }
                    className={cn(
                      "relative mt-1 max-w-full self-start font-medium leading-snug",
                      (canOpenHero || (!hero.track && hero.link)) &&
                        "after:absolute after:-inset-y-1 after:inset-x-0 hover:underline",
                    )}
                  >
                    <span className="block truncate" title={hero.title}>
                      {hero.title}
                    </span>
                  </HeroAction>
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
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
