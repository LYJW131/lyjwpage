/**
 * 页头 Ghostty 图标的帧数据（src/lib/ghostty-frames.json）由 scripts/ghostty-frames.mjs
 * 从 ghostty.org 首页的 ASCII 幽灵动画压制而来：每帧是一张 columns × rows 的符号网格，
 * 逐行游程编码；符号对应本体 / 光环的哪一档不透明度由 levels 说明。
 */

export type GhosttyFill = "body" | "glow";

export interface GhosttyFrameData {
  columns: number;
  rows: number;
  /** 单元的宽高比：源终端两列字符拼成一个单元，比正方形略窄 */
  cellAspect: number;
  frameMs: number;
  levels: Record<string, { fill: string; opacity: number }>;
  frames: string[];
}

export interface GhosttyLayer {
  fill: GhosttyFill;
  opacity: number;
  /** 同一档的所有单元合成一条 path：一次填充没有相邻矩形的抗锯齿接缝，缩到亚像素也干净 */
  d: string;
}

/** 解一行游程编码：`3#` 是连续 3 个 `#`，单个不写计数 */
function* runsOf(row: string): Generator<[symbol: string, count: number]> {
  for (const token of row.match(/\d*\D/g) ?? []) {
    yield [token.slice(-1), token.length > 1 ? Number(token.slice(0, -1)) : 1];
  }
}

/** 一帧编码里每行铺满的单元数，给校验用 */
export function ghosttyRowWidths(encoded: string): number[] {
  return encoded
    .split("/")
    .map((row) => Array.from(runsOf(row)).reduce((total, [, count]) => total + count, 0));
}

/** 把一帧（行以 `/` 分隔）解成按档分层的 path，空白单元不画 */
export function decodeGhosttyFrame(
  encoded: string,
  levels: GhosttyFrameData["levels"],
): GhosttyLayer[] {
  const paths = new Map<string, string>();
  encoded.split("/").forEach((row, y) => {
    let x = 0;
    for (const [symbol, count] of runsOf(row)) {
      if (symbol !== " ") {
        paths.set(symbol, `${paths.get(symbol) ?? ""}M${x} ${y}h${count}v1h-${count}z`);
      }
      x += count;
    }
  });
  return Object.entries(levels).flatMap(([symbol, { fill, opacity }]) => {
    const d = paths.get(symbol);
    return d ? [{ fill: fill === "glow" ? "glow" : "body", opacity, d } as const] : [];
  });
}

export function decodeGhosttyFrames(data: GhosttyFrameData): GhosttyLayer[][] {
  return data.frames.map((frame) => decodeGhosttyFrame(frame, data.levels));
}
