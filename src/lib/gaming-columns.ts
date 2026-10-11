// nth-child 步长 3 须与 playstation-card 的 TILE_TRACK 里 grid-rows-3 一致；Tailwind 只从源码字面量生成类，不能拼接。
export const GAME_COLUMN_SNAP_CLASS = "[&:nth-child(3n+1)]:snap-start";

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
