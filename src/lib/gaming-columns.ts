export const GAME_TILE_ROWS = 3;

export type ColumnBreakpoint = "base" | "md" | "lg";

export function trophyGroupColumns(count: number, breakpoint: ColumnBreakpoint): number {
  if (count <= 1 || breakpoint === "base") return 1;
  if (count <= 2 || breakpoint === "md") return 2;
  return 3;
}

export function isColumnStart(index: number, columns: number): boolean {
  return columns > 0 && index % columns === 0;
}

export function gameColumnSnapClass(rows = GAME_TILE_ROWS): string {
  return `[&:nth-child(${rows}n+1)]:snap-start`;
}

// 末列不满也保留。按行数裁掉余数会把列表末尾的游戏藏起来。
export function keepPartialGameColumn<T>(tiles: readonly T[]): readonly T[] {
  return tiles;
}

export function trophyGroupSnapClass(count: number): string {
  const frame = "flex min-w-0";
  if (count <= 1) return frame;
  if (count <= 2) {
    return `${frame} snap-start md:snap-align-none md:[&:nth-child(2n+1)]:snap-start`;
  }
  return `${frame} snap-start md:max-lg:snap-align-none md:max-lg:[&:nth-child(2n+1)]:snap-start lg:snap-align-none lg:[&:nth-child(3n+1)]:snap-start`;
}

export function trophyGroupTrackClass(count: number): string {
  const columns = [
    "grid grid-flow-col grid-rows-1 gap-3",
    "auto-cols-[100%]",
    "md:auto-cols-[calc((100%-0.75rem)/2)]",
  ];
  if (count > 2) columns.push("lg:auto-cols-[calc((100%-1.5rem)/3)]");
  return columns.join(" ");
}
