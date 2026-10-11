export const RECENT_VISIBLE_ROWS = 4;
export const RECENT_WIDE_COLUMNS = 2;
export const RECENT_WIDE_SLOTS = RECENT_VISIBLE_ROWS * RECENT_WIDE_COLUMNS;

export function recentTrackSnap(
  index: number,
  count: number,
  rows = RECENT_VISIBLE_ROWS,
): "start" | "end" | null {
  if (rows <= 0 || count <= 0 || index < 0 || index >= count || index % rows !== 0) return null;
  const columns = Math.ceil(count / rows);
  const column = index / rows;
  if (columns > 1 && column === columns - 1) return "end";
  return "start";
}
