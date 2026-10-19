import type { VoronoiLayout } from "./voronoi-layout";
import { MAP_AREA, MH, MW, MX, MY, RECT, centroid, polygonArea, type Point, type Polygon, type ShareCell, type Solved } from "./voronoi-solve";

export const SMALL_SHARE_PCT = 5;
export const AREA_TOLERANCE_PCT = 0.05;
export const HARD_MIN_EDGE = 6;

const onBorder = (a: Point, b: Point) =>
  (Math.abs(a[0] - b[0]) < 0.5 && (Math.abs(a[0] - MX) < 0.5 || Math.abs(a[0] - MX - MW) < 0.5)) ||
  (Math.abs(a[1] - b[1]) < 0.5 && (Math.abs(a[1] - MY) < 0.5 || Math.abs(a[1] - MY - MH) < 0.5));
const onFrame = (v: Point) => Math.abs(v[0] - MX) < 0.5 || Math.abs(v[0] - MX - MW) < 0.5 || Math.abs(v[1] - MY) < 0.5 || Math.abs(v[1] - MY - MH) < 0.5;
const edgeKey = (a: Point, b: Point) => [a, b].map((v) => `${v[0].toFixed(1)},${v[1].toFixed(1)}`).sort().join("|");
const angleAt = (a: Point, b: Point, c: Point) => {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
};

export type ScoreParts = {
  treemap: number;
  junction: number;
  cluster: number;
  center: number;
  sliver: number;
  edge: number;
  wedge: number;
  span: number;
};

export type WedgeAt = { cell: number; at: "t" | "b" | "l" | "r" | "triangle" };

export type Scored = { score: number; parts: ScoreParts; errMaxPct: number; minEdge: number; minAngle: number; wedges: WedgeAt[]; spans: number[] };

// 越低越好；系数与 LYJW131 生成脚本的 scoreOf 一致，是 lyjw 反复调过的定稿，改了会选出另一类布局。
export function scoreLayout({ polys, areas, targets }: Pick<Solved, "polys" | "areas" | "targets">): Scored {
  const p: ScoreParts = { treemap: 0, junction: 0, cluster: 0, center: 0, sliver: 0, edge: 0, wedge: 0, span: 0 };
  const errMaxPct = Math.max(...areas.map((a, i) => (Math.abs(a - targets[i]) / MAP_AREA) * 100));
  const edges = new Map<string, { L: number; a: Point; b: Point; cells: number[] }>();
  polys.forEach((poly, i) => poly.forEach((a, k) => {
    const b = poly[(k + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6 || onBorder(a, b)) return;
    const kk = edgeKey(a, b);
    let edge = edges.get(kk);
    if (!edge) edges.set(kk, (edge = { L, a, b, cells: [] }));
    edge.cells.push(i);
  }));
  let minEdge = 1e9;
  for (const e of edges.values()) {
    minEdge = Math.min(minEdge, e.L);
    const ang = (Math.atan2(Math.abs(e.b[1] - e.a[1]), Math.abs(e.b[0] - e.a[0])) * 180) / Math.PI, off = Math.min(ang, 90 - ang);
    if (off < 12 && e.L > 30) p.treemap += ((12 - off) * e.L) / 10;
  }
  if (minEdge < 14) p.edge = (14 - minEdge) * 15;
  let minAngle = 180;
  for (const poly of polys) for (let k = 0; k < poly.length; k++) {
    const b = poly[k];
    if (onFrame(b)) continue;
    const ang = angleAt(poly[(k + poly.length - 1) % poly.length], b, poly[(k + 1) % poly.length]);
    minAngle = Math.min(minAngle, ang);
    if (ang < 70) p.junction += (70 - ang) ** 2 / 4;
  }
  const C = polys.map((q) => (q.length >= 3 ? centroid(q) : [0, 0] as Point));
  const small = targets.map((t) => (t / MAP_AREA) * 100 < SMALL_SHARE_PCT);
  for (const e of edges.values()) if (e.cells.length === 2 && small[e.cells[0]] && small[e.cells[1]]) p.cluster += 40;
  for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
    if (!small[i] || !small[j]) continue;
    const d = Math.hypot(C[i][0] - C[j][0], C[i][1] - C[j][1]);
    if (d < 130) p.cluster += (130 - d) * 0.8;
  }
  const big = targets.indexOf(Math.max(...targets));
  p.center = (Math.abs(C[big][0] - (MX + MW / 2)) / MW) * 300;
  polys.forEach((poly, i) => {
    let P = 0;
    for (let k = 0; k < poly.length; k++) {
      const b = poly[(k + 1) % poly.length];
      P += Math.hypot(b[0] - poly[k][0], b[1] - poly[k][1]);
    }
    const c = P > 0 ? (4 * Math.PI * areas[i]) / (P * P) : 0;
    if (c < 0.65) p.sliver += (0.65 - c) * 600;
  });
  const wedges: WedgeAt[] = [];
  polys.forEach((poly, cell) => {
    const vs = poly.filter((v, k) => Math.hypot(v[0] - poly[(k + 1) % poly.length][0], v[1] - poly[(k + 1) % poly.length][1]) > 0.5);
    if (vs.length <= 3) {
      p.wedge += 150;
      wedges.push({ cell, at: "triangle" });
    }
    for (let k = 0; k < vs.length; k++) {
      const b = vs[k];
      if (!onFrame(b) || RECT.some((q) => Math.hypot(q[0] - b[0], q[1] - b[1]) < 0.5)) continue;
      const ang = angleAt(vs[(k + vs.length - 1) % vs.length], b, vs[(k + 1) % vs.length]);
      if (ang < 55) {
        p.wedge += (55 - ang) ** 2 / 3;
        const at = Math.abs(b[1] - MY) < 0.5 ? "t" : Math.abs(b[1] - MY - MH) < 0.5 ? "b" : Math.abs(b[0] - MX) < 0.5 ? "l" : "r";
        wedges.push({ cell, at });
      }
    }
  });
  const spans: number[] = [];
  polys.forEach((poly, i) => {
    const side = { t: false, b: false, l: false, r: false };
    poly.forEach((a, k) => {
      const b = poly[(k + 1) % poly.length];
      if (!onBorder(a, b) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) return;
      if (Math.abs(a[1] - MY) < 0.5) side.t = true;
      else if (Math.abs(a[1] - MY - MH) < 0.5) side.b = true;
      else if (Math.abs(a[0] - MX) < 0.5) side.l = true;
      else side.r = true;
    });
    if ((side.t && side.b) || (side.l && side.r)) {
      p.span += 120 + (targets[i] / MAP_AREA) * 100 * 8;
      spans.push(i);
    }
  });
  const score = Object.values(p).reduce((s, v) => s + v, 0) + (errMaxPct > AREA_TOLERANCE_PCT ? 1e4 : 0);
  return { score, parts: p, errMaxPct, minEdge, minAngle, wedges, spans };
}

function spanAt(p: Polygon, y: number): [number, number] {
  const xs: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  return xs.length < 2 ? [0, 0] : [Math.min(...xs), Math.max(...xs)];
}

function inside(p: Polygon, x: number, y: number): boolean {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const c = Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
    if (c !== 0) {
      if (s === 0) s = c;
      else if (c !== s) return false;
    }
  }
  return true;
}

// 不可达极点（近似）：格点里离各条边最远的点，标签放这里比放质心稳。
export function pole(p: Polygon): Point {
  const xs = p.map((v) => v[0]), ys = p.map((v) => v[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = centroid(p), bd = -1;
  for (let gx = 0; gx <= 40; gx++) for (let gy = 0; gy <= 24; gy++) {
    const x = x0 + ((x1 - x0) * gx) / 40, y = y0 + ((y1 - y0) * gy) / 24;
    if (!inside(p, x, y)) continue;
    let d = 1e9;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      d = Math.min(d, Math.abs((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / L);
    }
    if (d > bd) {
      bd = d;
      best = [x, y];
    }
  }
  return best;
}

export type CellLabel = { at: Point; nameSize: 13 | 11 | null; show: boolean };

// 小格（<5%）整格留白交给图例；大格先试 13px 名字+百分比，放不下降到 11px，再放不下只写百分比。
export function labelFor(poly: Polygon, name: string, sharePct: number): CellLabel {
  const at = pole(poly);
  if (sharePct < SMALL_SHARE_PCT) return { at, nameSize: null, show: false };
  const [px, py] = at;
  const fits = (w: number, rows: number[]) => rows.every((y) => {
    const [a, b] = spanAt(poly, y);
    return Math.min(px - a, b - px) * 2 >= w + 12;
  });
  const nameSize = ([13, 11] as const).find((f) => fits(name.length * f * 0.6, [py - f, py - 2, py + 14])) ?? null;
  return { at, nameSize, show: true };
}

export type HardIssue = "area" | "vanished" | "short-edge" | "span" | "wedge" | "label";

export type Assessment = Scored & { hard: HardIssue[]; occurrences: string[]; labels: CellLabel[] };

export function assess(solved: Solved, cells: readonly ShareCell[]): Assessment {
  const scored = scoreLayout(solved);
  const total = cells.reduce((sum, c) => sum + c.tokens, 0);
  const labels = solved.polys.map((poly, i) => (poly.length >= 3
    ? labelFor(poly, cells[i].model, (cells[i].tokens / total) * 100)
    : { at: [0, 0] as Point, nameSize: null, show: false }));
  const model = (i: number) => cells[i].model;
  const occurrences: string[] = [];
  if (scored.errMaxPct > AREA_TOLERANCE_PCT) occurrences.push("area");
  solved.polys.forEach((poly, i) => {
    if (poly.length < 3 || polygonArea(poly) < 1) occurrences.push(`vanished:${model(i)}`);
  });
  if (scored.minEdge < HARD_MIN_EDGE) occurrences.push("short-edge");
  for (const i of scored.spans) occurrences.push(`span:${model(i)}`);
  const seen = new Map<string, number>();
  for (const { cell, at } of scored.wedges) {
    const base = `wedge:${model(cell)}:${at}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    occurrences.push(n === 1 ? base : `${base}#${n}`);
  }
  labels.forEach((label, i) => {
    if (label.show && label.nameSize === null) occurrences.push(`label:${model(i)}`);
  });
  const hard = [...new Set(occurrences.map((key) => key.split(":")[0] as HardIssue))];
  return { ...scored, hard, occurrences, labels };
}

export function newHardIssues(assessment: Pick<Assessment, "occurrences">, layout: Pick<VoronoiLayout, "accepted">): string[] {
  return assessment.occurrences.filter((key) => !layout.accepted.includes(key));
}

// 软性变差：比选定时差到 1.5 倍，或多出 100 分以上，就记为该重排。
export function softDegraded(score: number, chosenScore: number): boolean {
  return score > chosenScore * 1.5 || score > chosenScore + 100;
}
