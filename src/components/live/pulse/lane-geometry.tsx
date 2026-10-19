import type { ReactNode } from "react";

export const LANE_WIDTH = 240;
export const LANE_HEIGHT = 24;
export const BAND_TOP = 4;
export const IDLE_HEIGHT = 2;

export type Range = { from: number; to: number };
export type TraceStyle = "hatched" | "faint";

export type LaneItem = {
  from: number;
  to: number;
  rank: number;
  content: ReactNode;
};

export type LaneModel = {
  items: LaneItem[];
  svg: ReactNode;
  // SVG 横向拉伸会扭曲图案和文字，二者须放在 HTML 叠层。
  under?: ReactNode;
  over?: ReactNode;
  summary: { value: ReactNode; detail: ReactNode } | null;
  aria: string;
};

const time = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function pulseDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function x(range: Range, at: number): number {
  return ((at - range.from) / Math.max(1, range.to - range.from)) * LANE_WIDTH;
}
export function percent(range: Range, at: number): string {
  return `${((at - range.from) / Math.max(1, range.to - range.from)) * 100}%`;
}
export function absolute(range: Range, row: { startSec: number; endSec: number }) {
  return { from: range.from + row.startSec * 1000, to: range.from + row.endSec * 1000 };
}

export function Rect({ range, from, to, top, fill, opacity = 1 }: { range: Range; from: number; to: number; top: number; fill: string; opacity?: number }) {
  const left = x(range, from);
  return <rect x={left} y={top} width={Math.max(0.2, x(range, to) - left)} height={LANE_HEIGHT - top} fill={fill} fillOpacity={opacity} />;
}

// 编码泳道一天能有几百段，逐段一个 <rect> 会让首屏 HTML 与 DOM 膨胀，所以同色段并进一条 path。
// 不足最小宽度的段，溢出部分应让给其后最近的彩色段；按颜色分组绘制不是时间顺序，所以先按时间裁掉溢出。
export function codingBars(range: Range, rows: { from: number; to: number; state: number }[]) {
  const merged = runs(rows);
  let limit = Infinity;
  const bars = [];
  for (const row of [...merged].reverse()) {
    const left = x(range, row.from);
    bars.push({ state: row.state, left, width: Math.max(0, Math.min(Math.max(0.2, x(range, row.to) - left), limit - left)) });
    if (row.state) limit = left;
  }
  return bars;
}

export function barPath(rows: { left: number; width: number }[], top: number): string {
  const fixed = (value: number) => Number(value.toFixed(2));
  return rows.map(({ left, width }) => `M${fixed(left)} ${top}h${fixed(width)}v${LANE_HEIGHT - top}h${-fixed(width)}z`).join("");
}

export function IdleLine({ range, from, to }: { range: Range; from: number; to: number }) {
  return <Rect range={range} from={from} to={to} top={LANE_HEIGHT - IDLE_HEIGHT} fill="currentColor" opacity={0.42} />;
}

export function Tooltip({ from, to, head, lines }: { from: number; to: number; head: string; lines: (ReactNode | null | false)[] }) {
  return (
    <div className="text-xs">
      <div className="font-mono text-muted-foreground">{time(from)}–{time(to)}</div>
      <div className="mt-1 font-medium">{head}</div>
      {lines.filter(Boolean).map((line, index) => <div key={index} className="mt-0.5 break-words">{line}</div>)}
    </div>
  );
}

export function runs(rows: { from: number; to: number; state: number }[]) {
  const merged: { from: number; to: number; state: number }[] = [];
  for (const row of rows) {
    const last = merged.at(-1);
    if (last && last.to === row.from && last.state === row.state) last.to = row.to;
    else merged.push({ ...row });
  }
  return merged;
}

// 斜纹从每个元素的左缘起算，相接的 trace 分开画会在接缝处错位。
export function spans(rows: { from: number; to: number }[]) {
  const merged: { from: number; to: number }[] = [];
  for (const row of [...rows].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && row.from <= last.to) last.to = Math.max(last.to, row.to);
    else merged.push({ ...row });
  }
  return merged;
}
