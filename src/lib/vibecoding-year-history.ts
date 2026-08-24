import { heatmapRefreshFrom } from "@/lib/heatmap-window";
import type { VibeCodingYearPayload } from "@/lib/types";
import { mergeVibeCodingYear } from "@/lib/vibecoding-year";

/**
 * 年度 token 热力图的客户端累加器。游标是今天（窗口若已填到未来的周六，
 * 仍从今天问起），切回焦点只拉窗尾。
 */

let snapshot: VibeCodingYearPayload | null = null;

export function vibeCodingYearCursor(): string | null {
  return snapshot ? heatmapRefreshFrom(snapshot.origin, snapshot.days.length) : null;
}

export function seedVibeCodingYear(payload: VibeCodingYearPayload): void {
  if (snapshot?.days.length || payload.daysPartial) return;
  snapshot = mergeVibeCodingYear(null, payload);
}

export function mergeVibeCodingYearHistory(
  payload: VibeCodingYearPayload,
): VibeCodingYearPayload {
  snapshot = mergeVibeCodingYear(snapshot, payload);
  return snapshot;
}
