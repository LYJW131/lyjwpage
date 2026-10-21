"use client";

import NumberFlow, { NumberFlowGroup } from "@/components/ui/number-flow";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { LYRIC_LINE_VARIANTS, LyricWords } from "@/components/live/hero-lyrics";
import { useLeap } from "@/hooks/use-leap";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { cueAt, NO_CUE } from "@/lib/lyrics-cue";
import type { LyricLine } from "@shared/lyrics-ttml";
import { STATIC_VARIANTS } from "@/lib/motion";
import { trackPositionMs } from "@/lib/track-position";
import type { LocalNowPlaying } from "@shared/types";
import { cn } from "@/lib/utils";

// 正常走表一步不超过 1 秒（每秒一拍，换句定时器拍得更密），超过这个跨度就是对时或换锚点。
const PROGRESS_LEAP_MS = 2_500;
export function formatDuration(milliseconds: number) {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function formatMargin(milliseconds: number) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  return seconds < 90 ? `±${seconds}s` : `±${Math.round(seconds / 60)}m`;
}

export function paletteGradient(palette: string[]): string | undefined {
  if (palette.length < 2) return undefined;
  const stops = [...palette, palette[0]]
    .map((color) => (color.startsWith("#") ? color : `#${color}`))
    .map((color) => `oklch(from ${color} 0.74 max(c, 0.09) h)`)
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

// 两层动画必须从挂载时同步起步；条件挂载会让渐变交叉淡入时错相。
export function PaletteBar({
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

export function Bars({ state }: { state: BarsState }) {
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

function Clock({ milliseconds, animated = true }: { milliseconds: number; animated?: boolean }) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return (
    <>
      <NumberFlow value={Math.floor(seconds / 60)} locales="en-US" animated={animated} />
      <span>:</span>
      <NumberFlow
        value={seconds % 60}
        locales="en-US"
        format={{ minimumIntegerDigits: 2 }}
        animated={animated}
      />
    </>
  );
}

export function HeroProgress({
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
  const leap = useLeap(position, PROGRESS_LEAP_MS);
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
            <Clock milliseconds={position} animated={!leap} />
            <span> / </span>
            <Clock milliseconds={track.durationMs} animated={!leap} />
          </span>
        </NumberFlowGroup>
      </div>
      <div className="mt-1.5 h-0.75 overflow-hidden bg-muted">
        <PaletteBar
          className={cn("h-full", !leap && "transition-[width] duration-700 ease-linear")}
          base={playing ? gradient : undefined}
          motion={playing ? motionGradient : undefined}
          idleClassName={playing ? "bg-live" : "bg-muted-foreground"}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </>
  );
}
