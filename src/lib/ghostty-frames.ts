
export type GhosttyFill = "body" | "glow";

export interface GhosttyFrameData {
  columns: number;
  rows: number;
  cellAspect: number;
  frameMs: number;
  levels: Record<string, { fill: string; opacity: number }>;
  frames: string[];
}

export interface GhosttyLayer {
  fill: GhosttyFill;
  opacity: number;
  d: string;
}

function* runsOf(row: string): Generator<[symbol: string, count: number]> {
  for (const token of row.match(/\d*\D/g) ?? []) {
    yield [token.slice(-1), token.length > 1 ? Number(token.slice(0, -1)) : 1];
  }
}

export function ghosttyRowWidths(encoded: string): number[] {
  return encoded
    .split("/")
    .map((row) => Array.from(runsOf(row)).reduce((total, [, count]) => total + count, 0));
}

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

// rAF 时间戳可能早于 effect 的起点；负数取余会产生无效帧索引。
export function ghosttyFrameIndex(elapsedMs: number, frameMs: number, count: number): number {
  if (!(count > 0)) return 0;
  const index = Math.floor(Math.max(0, elapsedMs) / frameMs) % count;
  return Number.isFinite(index) ? index : 0;
}
