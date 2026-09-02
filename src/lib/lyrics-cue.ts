import type { LyricLine } from "@/lib/lyrics-ttml";

/**
 * 此刻该亮哪一行。纯函数，进度条和歌词行共用 lib/track-position 推出来的同一个
 * position，所以画在进度条上的时刻和亮着的那句永远是同一份算法的两个读数。
 */

/**
 * 两句之间的空档不超过这么久就把上一句一直举到下一句开口。
 *
 * Apple 的行计时 end 和下一行的 begin 之间常有两三百毫秒的缝，按字面切的话
 * 每两句之间都会闪一下艺人名。真正的间奏（前奏、solo）比这长得多，那时退回
 * 艺人名是对的 —— 一句唱完的词举着不放，看起来像卡住了。
 */
export const LYRIC_HOLD_GAP_MS = 3_000;

export type LyricCue = {
  /** lines 里的下标；此刻没有该亮的行时为 -1 */
  index: number;
  /**
   * 这个结论到哪一刻会变（曲目内的毫秒位置）。null 表示这首歌接下来不会再变
   * （最后一句已经过去）—— 单曲循环绕回开头那一下由调用方按 durationMs 处理。
   */
  until: number | null;
};

export const NO_CUE: LyricCue = { index: -1, until: null };

/** lines 必须按 startMs 升序，parseLyricsTtml 出来的就是 */
export function cueAt(lines: LyricLine[], positionMs: number): LyricCue {
  if (!lines.length) return NO_CUE;

  // 最后一个 startMs <= position 的行。行数几十，线性扫就够了
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].startMs <= positionMs; i += 1) index = i;

  if (index < 0) return { index: -1, until: lines[0].startMs };

  const line = lines[index];
  const next = lines[index + 1] ?? null;
  // 这一句唱完之后到下一句开口前，举不举着看空档多长
  const holdUntil =
    next && next.startMs - line.endMs <= LYRIC_HOLD_GAP_MS ? next.startMs : line.endMs;

  if (positionMs < holdUntil) return { index, until: holdUntil };
  return { index: -1, until: next?.startMs ?? null };
}
