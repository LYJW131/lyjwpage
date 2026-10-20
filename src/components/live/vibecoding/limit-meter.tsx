"use client";

import { LIMIT_ON_PACE_COLOR, LIMIT_OVER_PACE_COLOR } from "@/components/live/vibecoding/limits";

export function PaceMarker({ pace, overPace }: { pace: number; overPace: boolean }) {
  if (pace < 0.1 || pace > 0.9) return null;

  return (
    <span
      aria-hidden
      className="absolute inset-y-0 flex w-1.5 justify-center bg-surface"
      style={{ left: `calc(${pace * 100}% - 3px)` }}
    >
      <span
        className="w-0.5"
        style={{ backgroundColor: overPace ? LIMIT_OVER_PACE_COLOR : LIMIT_ON_PACE_COLOR }}
      />
    </span>
  );
}
