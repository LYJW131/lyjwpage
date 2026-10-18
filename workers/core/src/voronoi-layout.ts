export type Point = [number, number];
export type Polygon = Point[];

export type ShareCell = { model: string; tokens: number };

// 站点坐标与权重都在纵向拉伸后的求解空间里，原样存、原样拿来重建，才能复现选定那一刻的格子。
export type LayoutCell = { model: string; color: string; site: Point; weight: number };

// accepted 是选定时就有、被认可了的硬性问题，按出现处记（问题:模型:边，见 assess 的 occurrences）；lyjw 选的 seed 2290 有一处撞边约 54°。
// 只有不在里面的出现处才逼重排：同类问题换了地方或多出一处都算新出现。
export type VoronoiLayout = {
  cells: LayoutCell[];
  chosenScore: number;
  chosenAt: number;
  seed: number | null;
  accepted: string[];
  // 进过前 7 的模型各自用过的颜色；跌出去再回来时，原色没被别的模型占着就还给它。
  colors?: Record<string, string>;
};

export const MX = 28;
export const MY = 124;
export const MW = 490;
export const MH = 190;
const MAP_AREA = MW * MH;
// 不拉伸时最大格的直径约等于地图高度，必然贯穿上下；在 y 放大的空间里求解再压回来，格子偏扁，上下能留出小格。
export const STRETCH = 1.3;
export const TOP_MODELS = 7;
export const OTHER_MODEL = "other";
export const OTHER_COLOR = "#6e7681";
export const PALETTE = ["#3178c6", "#e34c26", "#f1e05a", "#89e051", "#00add8", "#dea584", "#db61a2"];
export const SMALL_SHARE_PCT = 5;
export const SEARCH_SEEDS = 4000;
export const AREA_TOLERANCE_PCT = 0.05;
export const HARD_MIN_EDGE = 6;

const SOLVE_ITERATIONS = 3000;
const LLOYD_UNTIL = 1500;
const ADAPT_TOLERANCE_PCT = 0.005;

const RECT: Polygon = [[MX, MY], [MX + MW, MY], [MX + MW, MY + MH], [MX, MY + MH]];
const RECT_S: Polygon = RECT.map(([x, y]) => [x, y * STRETCH]);

export function shareCells(totalTokens: number, topModels: readonly ShareCell[]): ShareCell[] {
  // 真有模型叫 other 时并进汇总格：模型名是格子的唯一键，两个 other 会互相覆盖。
  const top = topModels.filter((m) => m.model !== OTHER_MODEL).slice(0, TOP_MODELS).filter((m) => m.tokens > 0);
  const other = totalTokens - top.reduce((sum, m) => sum + m.tokens, 0);
  return other > 0 ? [...top, { model: OTHER_MODEL, tokens: other }] : top;
}

function clip(poly: Polygon, a: number, b: number, c: number): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = a * p[0] + b * p[1] - c, fq = a * q[0] + b * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

export function polygonArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

export function centroid(poly: Polygon): Point {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  a /= 2;
  return [cx / (6 * a), cy / (6 * a)];
}

function buildPolys(sites: readonly Point[], weights: readonly number[]): Polygon[] {
  return sites.map((s, i) => {
    let poly: Polygon = RECT_S.map((p) => [p[0], p[1]]);
    for (let j = 0; j < sites.length && poly.length; j++) {
      if (j === i) continue;
      const t = sites[j];
      poly = clip(poly, 2 * (t[0] - s[0]), 2 * (t[1] - s[1]), t[0] * t[0] + t[1] * t[1] - s[0] * s[0] - s[1] * s[1] + weights[i] - weights[j]);
    }
    return poly;
  });
}

const cellArea = (poly: Polygon) => (poly.length >= 3 ? polygonArea(poly) : 0);
const unstretch = (polys: Polygon[]) => polys.map((p) => p.map(([x, y]): Point => [x, y / STRETCH]));

export type Solved = {
  sites: Point[];
  weights: number[];
  polys: Polygon[];
  areas: number[];
  targets: number[];
};

const targetsOf = (cells: readonly ShareCell[]) => {
  const total = cells.reduce((sum, c) => sum + c.tokens, 0);
  return cells.map((c) => (c.tokens / total) * MAP_AREA);
};

function finish(sites: Point[], weights: number[], targets: number[]): Solved {
  const polys = unstretch(buildPolys(sites, weights));
  return { sites, weights, polys, areas: polys.map(cellArea), targets };
}

// 与 LYJW131 生成脚本的 solve 逐步一致：同一种子、同一份份额得到同一张图，lyjw 选定的 seed 2290 才复现得出来。
export function solveSeed(seedIndex: number, cells: readonly ShareCell[]): Solved {
  const targets = targetsOf(cells);
  const targetsS = targets.map((t) => t * STRETCH);
  let seed = seedIndex * 7919 + 13;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let sites: Point[] = cells.map(() => [MX + rnd() * MW, (MY + rnd() * MH) * STRETCH]);
  const weights = cells.map(() => 0);
  for (let it = 0; it < SOLVE_ITERATIONS; it++) {
    const polys = buildPolys(sites, weights);
    for (let i = 0; i < cells.length; i++) weights[i] += (0.35 * (targetsS[i] - cellArea(polys[i]))) / 6;
    if (it % 3 === 2 && it < LLOYD_UNTIL) sites = sites.map((s, i) => (polys[i].length >= 3 ? centroid(polys[i]) : s));
  }
  return finish(sites, weights, targets);
}

// 站点不动，只迭代权重贴合新份额；movable 里的站点（新插进来的模型和 other）在前半程做 Lloyd 松弛，别的格子不挪位置。
export function refit(
  sitesIn: readonly Point[],
  weightsIn: readonly number[],
  cells: readonly ShareCell[],
  movable: ReadonlySet<number> = new Set(),
): Solved {
  const targets = targetsOf(cells);
  const targetsS = targets.map((t) => t * STRETCH);
  const sites = sitesIn.map((s): Point => [s[0], s[1]]);
  const weights = [...weightsIn];
  const tolerance = (ADAPT_TOLERANCE_PCT / 100) * MAP_AREA * STRETCH;
  for (let it = 0; it < SOLVE_ITERATIONS; it++) {
    const polys = buildPolys(sites, weights);
    const relaxing = movable.size > 0 && it < LLOYD_UNTIL;
    let worst = 0;
    for (let i = 0; i < cells.length; i++) {
      const diff = targetsS[i] - cellArea(polys[i]);
      worst = Math.max(worst, Math.abs(diff));
      weights[i] += (0.35 * diff) / 6;
    }
    if (!relaxing && worst <= tolerance) break;
    if (relaxing && it % 3 === 2) for (const i of movable) if (polys[i].length >= 3) sites[i] = centroid(polys[i]);
  }
  return finish(sites, weights, targets);
}

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

// 换人时被认可的出现处跟着站点走：接过站点的新模型继承掉出去那个模型的认可。
function renameAccepted(accepted: readonly string[], renamed: ReadonlyMap<string, string>): string[] {
  return accepted.map((key) => {
    const [kind, model, ...rest] = key.split(":");
    const heir = model === undefined ? undefined : renamed.get(model);
    return heir ? [kind, heir, ...rest].join(":") : key;
  });
}

// 软性变差：比选定时差到 1.5 倍，或多出 100 分以上，就记为该重排。
export function softDegraded(score: number, chosenScore: number): boolean {
  return score > chosenScore * 1.5 || score > chosenScore + 100;
}

export type Fitted = {
  layout: VoronoiLayout;
  cells: ShareCell[];
  solved: Solved;
  assessment: Assessment;
  structureChanged: boolean;
};

const colorMemory = (layout: VoronoiLayout, cells: readonly LayoutCell[]): Record<string, string> => ({
  ...layout.colors,
  ...Object.fromEntries(layout.cells.map((l) => [l.model, l.color])),
  ...Object.fromEntries(cells.map((l) => [l.model, l.color])),
});

const sameMembers = (layout: VoronoiLayout, cells: readonly ShareCell[]) =>
  layout.cells.length === cells.length && cells.every((c) => layout.cells.some((l) => l.model === c.model));

function freeColor(used: Set<string>, preferred?: string): string {
  const color = preferred && !used.has(preferred)
    ? preferred
    : (PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length]);
  used.add(color);
  return color;
}

// 名次互换只换份额，格子身份、站点和颜色都跟着模型走。有模型进出前 7 时，新模型先接过掉出去那个模型的站点（第 7 名换人是最常见的变化，原地接替布局最稳）；
// 没有空出来的站点可接时才在 other 格中心附近插一个点。掉出去的份额并回 other。
export function fitLayout(layout: VoronoiLayout, latest: readonly ShareCell[]): Fitted {
  if (sameMembers(layout, latest)) {
    const cells = layout.cells.map((l) => latest.find((c) => c.model === l.model) as ShareCell);
    const solved = refit(layout.cells.map((l) => l.site), layout.cells.map((l) => l.weight), cells);
    return { layout, cells, solved, assessment: assess(solved, cells), structureChanged: false };
  }
  const present = (model: string) => latest.some((c) => c.model === model);
  const departed = layout.cells.filter((l) => !present(l.model) && l.model !== OTHER_MODEL);
  const added = latest.filter((c) => !layout.cells.some((l) => l.model === c.model));
  const heirs = added.filter((c) => c.model !== OTHER_MODEL).slice(0, departed.length);
  const inserted = added.filter((c) => !heirs.includes(c));
  const used = new Set(layout.cells.filter((l) => present(l.model)).map((l) => l.color));
  const remembered = colorMemory(layout, []);
  const colorFor = (model: string) => (model === OTHER_MODEL ? OTHER_COLOR : freeColor(used, remembered[model]));

  const next: LayoutCell[] = layout.cells.flatMap((l): LayoutCell[] => {
    if (present(l.model)) return [{ ...l, site: [l.site[0], l.site[1]] }];
    const heir = heirs[departed.indexOf(l)];
    return heir ? [{ model: heir.model, color: colorFor(heir.model), site: [l.site[0], l.site[1]], weight: l.weight }] : [];
  });
  if (inserted.length) {
    const oldPolys = buildPolys(layout.cells.map((l) => l.site), layout.cells.map((l) => l.weight));
    const other = layout.cells.findIndex((l) => l.model === OTHER_MODEL);
    const areas = oldPolys.map(cellArea);
    const anchorIndex = other >= 0 ? other : areas.indexOf(Math.max(...areas));
    const anchorPoly = oldPolys[anchorIndex];
    const anchor = anchorPoly.length >= 3 ? centroid(anchorPoly) : layout.cells[anchorIndex].site;
    inserted.forEach((c, k) => {
      const angle = (2 * Math.PI * k) / inserted.length;
      next.push({
        model: c.model,
        color: colorFor(c.model),
        site: [anchor[0] + 12 * Math.cos(angle), anchor[1] + 12 * Math.sin(angle)],
        weight: layout.cells[anchorIndex].weight,
      });
    });
  }
  const cells = next.map((l) => latest.find((c) => c.model === l.model) as ShareCell);
  const insertedModels = new Set(inserted.map((c) => c.model));
  const movable = new Set(next.flatMap((l, i) => (insertedModels.size && (insertedModels.has(l.model) || l.model === OTHER_MODEL) ? [i] : [])));
  const solved = refit(next.map((l) => l.site), next.map((l) => l.weight), cells, movable);
  const adaptedCells = next.map((l, i) => ({ ...l, site: solved.sites[i], weight: solved.weights[i] }));
  const renamed = new Map(heirs.map((heir, k) => [departed[k].model, heir.model]));
  const adapted: VoronoiLayout = {
    ...layout,
    cells: adaptedCells,
    colors: colorMemory(layout, adaptedCells),
    accepted: renameAccepted(layout.accepted, renamed),
  };
  return { layout: adapted, cells, solved, assessment: assess(solved, cells), structureChanged: true };
}

// 颜色按模型固定：搜索得出的新布局沿用旧布局里各模型的颜色，新模型取空出来的色。
export function layoutFromSearch(
  solved: Pick<Solved, "sites" | "weights">,
  cells: readonly ShareCell[],
  previous: VoronoiLayout,
  score: number,
  seed: number,
  now: number,
): VoronoiLayout {
  const used = new Set<string>();
  const colorOf = new Map(previous.cells.map((l) => [l.model, l.color]));
  const remembered = colorMemory(previous, []);
  for (const c of cells) {
    const color = colorOf.get(c.model);
    if (color && c.model !== OTHER_MODEL) used.add(color);
  }
  const layoutCells = cells.map((c, i): LayoutCell => ({
    model: c.model,
    color: c.model === OTHER_MODEL ? OTHER_COLOR : (colorOf.get(c.model) ?? freeColor(used, remembered[c.model])),
    site: solved.sites[i],
    weight: solved.weights[i],
  }));
  return {
    cells: layoutCells,
    colors: colorMemory(previous, layoutCells),
    chosenScore: score,
    chosenAt: now,
    seed,
    accepted: [],
  };
}
