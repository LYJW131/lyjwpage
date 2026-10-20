import { assess, type Assessment } from "./voronoi-assess";
import { buildPolys, cellArea, centroid, refit, type Point, type ShareCell, type Solved } from "./voronoi-solve";

export {
  MH,
  MW,
  MX,
  MY,
  STRETCH,
  centroid,
  polygonArea,
  refit,
  solveSeed,
  type Point,
  type Polygon,
  type ShareCell,
  type Solved,
} from "./voronoi-solve";
export {
  AREA_TOLERANCE_PCT,
  HARD_MIN_EDGE,
  SMALL_SHARE_PCT,
  assess,
  labelFor,
  newHardIssues,
  pole,
  scoreLayout,
  softDegraded,
  type Assessment,
  type CellLabel,
  type HardIssue,
  type ScoreParts,
  type Scored,
  type WedgeAt,
} from "./voronoi-assess";

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

export const TOP_MODELS = 7;
export const OTHER_MODEL = "other";
export const OTHER_COLOR = "#6e7681";
export const PALETTE = ["#3178c6", "#e34c26", "#f1e05a", "#89e051", "#00add8", "#dea584", "#db61a2"];
export const SEARCH_SEEDS = 4000;

export function shareCells(totalTokens: number, topModels: readonly ShareCell[]): ShareCell[] {
  // 真有模型叫 other 时并进汇总格：模型名是格子的唯一键，两个 other 会互相覆盖。
  const top = topModels.filter((m) => m.model !== OTHER_MODEL).slice(0, TOP_MODELS).filter((m) => m.tokens > 0);
  const other = totalTokens - top.reduce((sum, m) => sum + m.tokens, 0);
  return other > 0 ? [...top, { model: OTHER_MODEL, tokens: other }] : top;
}

// 换人时被认可的出现处跟着站点走：接过站点的新模型继承掉出去那个模型的认可。
function renameAccepted(accepted: readonly string[], renamed: ReadonlyMap<string, string>): string[] {
  return accepted.map((key) => {
    const [kind, model, ...rest] = key.split(":");
    const heir = model === undefined ? undefined : renamed.get(model);
    return heir ? [kind, heir, ...rest].join(":") : key;
  });
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
  layout.cells.length === cells.length
  && cells.every((c) => layout.cells.some((l) => l.model === c.model))
  && layout.cells.every((l) => cells.some((c) => c.model === l.model));

function shareOf(latest: readonly ShareCell[], model: string): ShareCell {
  const cell = latest.find((c) => c.model === model);
  if (!cell) throw new Error(`voronoi: ${model} 不在最新份额里`);
  return cell;
}

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
    const cells = layout.cells.map((l) => shareOf(latest, l.model));
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
  const cells = next.map((l) => shareOf(latest, l.model));
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
