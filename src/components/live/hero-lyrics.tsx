"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useMountedAt } from "@/hooks/use-mounted-at";
import { cueAt } from "@/lib/lyrics-cue";
import type { LyricLine, LyricWord } from "@/lib/lyrics-ttml";
import { trackPositionMs } from "@/lib/track-position";
import type { LocalNowPlaying } from "@/lib/types";
import { cn } from "@/lib/utils";


export const LYRIC_LINE_VARIANTS = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.14, ease: "easeIn" } },
};

export function LyricWords({ words, track }: { words: LyricWord[]; track: LocalNowPlaying }) {
  const ref = useRef<HTMLSpanElement>(null);
  const maxAtRef = useRef<number>(0);
  const { state, observedAt, positionMs, durationMs, repeatOne, trackId } = track;

  useEffect(() => {
    maxAtRef.current = 0;
  }, [words, trackId, observedAt]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const anchor = { state, observedAt, positionMs, durationMs, repeatOne };

    const paint = () => {
      const at = trackPositionMs(anchor, Date.now());
      let currentAt = at;
      if (state === "playing") {
        if (at < maxAtRef.current - 1500) {
          maxAtRef.current = at;
          currentAt = at;
        } else {
          currentAt = Math.max(at, maxAtRef.current);
          maxAtRef.current = currentAt;
        }
      } else {
        maxAtRef.current = at;
        currentAt = at;
      }

      words.forEach((word, i) => {
        const span = node.children[i] as HTMLElement | undefined;
        if (!span) return;
        const lengthMs = word.endMs - word.startMs;
        const ratio =
          lengthMs <= 0
            ? currentAt >= word.startMs
              ? 1
              : 0
            : Math.max(0, Math.min(1, (currentAt - word.startMs) / lengthMs));

        if (ratio <= 0) {
          if (span.dataset.sung !== "pending") {
            span.dataset.sung = "pending";
            span.style.removeProperty("--sung");
          }
        } else if (ratio >= 1) {
          if (span.dataset.sung !== "done") {
            span.dataset.sung = "done";
            span.style.removeProperty("--sung");
          }
        } else {
          span.dataset.sung = "active";
          span.style.setProperty("--sung", `${(ratio * 100).toFixed(1)}%`);
        }
      });
    };

    paint();
    if (state !== "playing") return;
    let frame = requestAnimationFrame(function loop() {
      paint();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [words, state, observedAt, positionMs, durationMs, repeatOne]);

  return (
    <span ref={ref}>
      {words.map((word, i) => (
        <span key={i} className="lyric-word" data-sung="pending">
          {word.text}
        </span>
      ))}
    </span>
  );
}

export function HeroLyrics({
  lyrics,
  track,
  songwriters,
  reduced = false,
}: {
  lyrics: LyricLine[];
  track: LocalNowPlaying;
  songwriters?: string[];
  reduced?: boolean;
}) {
  const playing = track.state === "playing";
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = (playing && mountedAt ? Math.max(ticked, track.observedAt) : ticked) || mountedAt;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setTicked(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [playing]);

  const displayLyrics = useMemo(() => {
    if (!lyrics.length) return lyrics;
    const first = lyrics[0];
    const last = lyrics[lyrics.length - 1];
    const creator = (
      songwriters && songwriters.length > 0 ? songwriters.join("、") : track.artist
    )?.trim();

    const introLead = Math.min(Math.max(first.startMs, 0), 2_400);
    const introStart = Math.max(0, first.startMs - introLead);
    const dotDuration = introLead > 0 ? introLead / 3 : 0;

    const introLine: LyricLine = {
      startMs: 0,
      endMs: first.startMs,
      text: "···",
      words:
        dotDuration > 0
          ? [
              { startMs: introStart, endMs: introStart + dotDuration, text: "·" },
              { startMs: introStart + dotDuration, endMs: introStart + dotDuration * 2, text: "·" },
              { startMs: introStart + dotDuration * 2, endMs: first.startMs, text: "·" },
            ]
          : undefined,
    };

    const outroStart = last.endMs;
    const outroEnd = Math.max(track.durationMs || 0, outroStart + 300_000);
    const outroLine: LyricLine = {
      startMs: outroStart,
      endMs: outroEnd,
      text: creator ? `Written by ${creator}` : "Credits",
    };

    return [introLine, ...lyrics, outroLine];
  }, [lyrics, songwriters, track.artist, track.durationMs]);

  const { observedAt, positionMs, durationMs, repeatOne } = track;
  useEffect(() => {
    if (!playing || !displayLyrics.length) return;
    const anchor = { state: "playing" as const, observedAt, positionMs, durationMs, repeatOne };
    const at = trackPositionMs(anchor, Math.max(now, Date.now()));
    const { until } = cueAt(displayLyrics, at);
    const target = until ?? (repeatOne && durationMs > 0 ? durationMs : null);
    if (target == null) return;
    const timer = window.setTimeout(() => setTicked(Date.now()), Math.max(16, target - at + 8));
    return () => window.clearTimeout(timer);
  }, [playing, displayLyrics, now, observedAt, positionMs, durationMs, repeatOne]);

  const position = trackPositionMs(track, now);
  const cue = cueAt(displayLyrics, position);

  let activeIdx = 0;
  let isSinging = false;
  const lastLyricIdx = Math.max(1, displayLyrics.length - 2);

  if (cue.index >= 0) {
    activeIdx = Math.min(cue.index, lastLyricIdx);
    isSinging = cue.index <= lastLyricIdx;
  } else {
    let index = -1;
    for (let i = 0; i < displayLyrics.length && displayLyrics[i].startMs <= position; i += 1) {
      index = i;
    }
    activeIdx = Math.max(0, Math.min(index, lastLyricIdx));
    isSinging = false;
  }

  const LINE_HEIGHT = 26;
  const maxIdx = lastLyricIdx;
  const scrollIdx = Math.max(1, Math.min(activeIdx, maxIdx));
  const targetY = 27 - scrollIdx * LINE_HEIGHT;

  return (
    <div className="relative h-20 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent_0%,black_16%,black_84%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_16%,black_84%,transparent_100%)]">
      <motion.div
        className="flex flex-col"
        animate={{ y: targetY }}
        transition={
          reduced
            ? { duration: 0 }
            : { duration: 0.36, ease: [0.22, 1, 0.36, 1] }
        }
      >
        {displayLyrics.map((line, i) => {
          const isCurrent = i === activeIdx;
          const isIntro = i === 0;
          const isOutro = i === displayLyrics.length - 1;

          return (
            <div
              key={i}
              className="flex h-[26px] items-center"
              style={{ height: `${LINE_HEIGHT}px` }}
            >
              <motion.span
                className={
                  isOutro
                    ? "block truncate text-xs text-muted-foreground/60 origin-left"
                    : cn(
                        "block truncate text-sm font-medium origin-left transition-colors duration-500 ease-out",
                        isIntro && "tracking-[0.08em] font-bold",
                        isCurrent
                          ? isSinging
                            ? "text-foreground"
                            : "text-foreground/80"
                          : isIntro
                            ? "text-muted-foreground/60"
                            : "text-muted-foreground",
                      )
                }
                animate={{
                  scale: isOutro ? 1 : isCurrent ? 1 : 0.88,
                  opacity: isOutro ? 0.6 : isCurrent ? 1 : 0.4,
                }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: 0.36, ease: [0.22, 1, 0.36, 1] }
                }
                title={line.text}
              >
                {isCurrent && isSinging && line.words ? (
                  <LyricWords words={line.words} track={track} />
                ) : (
                  line.text
                )}
              </motion.span>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

export function HeroLyricsSkeleton() {
  return (
    <div className="flex h-20 flex-col justify-center gap-2 py-2" aria-hidden>
      <div className="h-3 w-2/5 animate-pulse rounded bg-muted/50" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted/50" />
    </div>
  );
}
