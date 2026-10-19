export type Point = [number, number];
export type Polygon = Point[];

export type ShareCell = { model: string; tokens: number };

export const MX = 28;
export const MY = 124;
export const MW = 490;
export const MH = 190;
export const MAP_AREA = MW * MH;
// 不拉伸时最大格的直径约等于地图高度，必然贯穿上下；在 y 放大的空间里求解再压回来，格子偏扁，上下能留出小格。
export const STRETCH = 1.3;

const SOLVE_ITERATIONS = 3000;
const LLOYD_UNTIL = 1500;
const ADAPT_TOLERANCE_PCT = 0.005;

export const RECT: Polygon = [[MX, MY], [MX + MW, MY], [MX + MW, MY + MH], [MX, MY + MH]];
const RECT_S: Polygon = RECT.map(([x, y]) => [x, y * STRETCH]);

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

export function buildPolys(sites: readonly Point[], weights: readonly number[]): Polygon[] {
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

export const cellArea = (poly: Polygon) => (poly.length >= 3 ? polygonArea(poly) : 0);
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
