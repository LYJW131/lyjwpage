"use client";

import { useState } from "react";

import { playbackProgressEases } from "@/lib/playback-progress";

export function usePlaybackProgressEase(
  percent: number,
  durationMs: number,
  sampleMs: number,
  reduced: boolean | null,
) {
  const [frame, setFrame] = useState<{ previous: number | null; percent: number }>({
    previous: null,
    percent,
  });

  if (!Object.is(frame.percent, percent)) {
    setFrame({ previous: frame.percent, percent });
  }

  const previous = Object.is(frame.percent, percent) ? frame.previous : frame.percent;
  return (
    reduced !== true && playbackProgressEases(previous, percent, durationMs, sampleMs)
  );
}
