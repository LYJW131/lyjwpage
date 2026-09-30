import type { LyricLine } from "@/lib/lyrics-ttml";


export const LYRIC_HOLD_GAP_MS = 3_000;

export type LyricCue = {
  index: number;
  until: number | null;
};

export const NO_CUE: LyricCue = { index: -1, until: null };

export function cueAt(lines: LyricLine[], positionMs: number): LyricCue {
  if (!lines.length) return NO_CUE;

  let index = -1;
  for (let i = 0; i < lines.length && lines[i].startMs <= positionMs; i += 1) index = i;

  if (index < 0) return { index: -1, until: lines[0].startMs };

  const line = lines[index];
  const next = lines[index + 1] ?? null;
  const holdUntil =
    next && next.startMs - line.endMs <= LYRIC_HOLD_GAP_MS ? next.startMs : line.endMs;

  if (positionMs < holdUntil) return { index, until: holdUntil };
  return { index: -1, until: next?.startMs ?? null };
}
