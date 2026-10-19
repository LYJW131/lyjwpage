import {
  SEARCH_SEEDS,
  assess,
  fitLayout,
  layoutFromSearch,
  newHardIssues,
  softDegraded,
  solveSeed,
  type Fitted,
  type Point,
  type ShareCell,
  type VoronoiLayout,
} from "./voronoi-layout";

export const RELAYOUT_COOLDOWN_MS = 86_400_000;
export const FAILED_SEARCH_RETRY_MS = 86_400_000;
// 新布局要比当前好 30% 以上才换，免得两个差不多的解来回跳。
export const RELAYOUT_GAIN = 0.3;
// 一个种子约 7ms CPU；一轮定时任务只跑一段，SEARCH_SEEDS 个种子分几轮跑完，不让单次调用逼近 Worker 的 CPU 上限。
export const SEARCH_CHUNK = 400;

export type SearchBest = { seed: number; score: number; sites: Point[]; weights: number[] };

export type SearchProgress = {
  cells: ShareCell[];
  next: number;
  best: SearchBest | null;
  startedAt: number;
  hard: boolean;
};

export type VoronoiState = {
  layout: VoronoiLayout;
  lastRelayoutAt: number;
  lastFailedSearchAt: number | null;
  search: SearchProgress | null;
};

export type RoundEvent =
  | { kind: "steady" }
  | { kind: "adapted" }
  | { kind: "due"; hard: string[]; soft: boolean; waitingUntil: number }
  | { kind: "searching"; next: number }
  | { kind: "relayout"; seed: number; from: number; to: number }
  | { kind: "kept"; best: number | null; current: number };

export type RoundResult = { state: VoronoiState; changed: boolean; event: RoundEvent };

const membership = (cells: readonly ShareCell[]) => cells.map((c) => c.model).sort().join("\n");

function runChunk(search: SearchProgress, chunk: number): SearchProgress {
  let best = search.best;
  const end = Math.min(search.next + chunk, SEARCH_SEEDS + 1);
  for (let seed = search.next; seed < end; seed++) {
    const solved = solveSeed(seed, search.cells);
    const assessment = assess(solved, search.cells);
    if (assessment.hard.length > 0) continue;
    if (!best || assessment.score < best.score) best = { seed, score: assessment.score, sites: solved.sites, weights: solved.weights };
  }
  return { ...search, next: end, best };
}

function finishSearch(state: VoronoiState, fit: Fitted, search: SearchProgress, latest: readonly ShareCell[], now: number): RoundResult {
  const current = fit.assessment.score;
  const base = { ...state, layout: fit.layout, search: null };
  if (search.best) {
    const draft = layoutFromSearch(
      search.best,
      search.cells,
      state.layout,
      search.best.score,
      search.best.seed,
      now,
    );
    const candidate = fitLayout(draft, latest);
    const better = candidate.assessment.score <= current * (1 - RELAYOUT_GAIN);
    if (better && candidate.assessment.hard.length === 0) {
      const layout = { ...draft, chosenScore: candidate.assessment.score };
      return {
        state: { layout, lastRelayoutAt: now, lastFailedSearchAt: null, search: null },
        changed: true,
        event: { kind: "relayout", seed: search.best.seed, from: current, to: candidate.assessment.score },
      };
    }
    return {
      state: { ...base, lastFailedSearchAt: now },
      changed: true,
      event: { kind: "kept", best: candidate.assessment.score, current },
    };
  }
  return { state: { ...base, lastFailedSearchAt: now }, changed: true, event: { kind: "kept", best: null, current } };
}

function continueSearch(state: VoronoiState, fit: Fitted, search: SearchProgress, latest: readonly ShareCell[], now: number, chunk: number): RoundResult {
  const progressed = runChunk(search, chunk);
  if (progressed.next > SEARCH_SEEDS) return finishSearch(state, fit, progressed, latest, now);
  return { state: { ...state, layout: fit.layout, search: progressed }, changed: true, event: { kind: "searching", next: progressed.next } };
}

// 定时任务每轮调一次：从存好的布局出发按最新份额求解，再按三层规则（结构变化、质量检查、防抖）决定沿用、标记还是重排。
export function relayoutRound(state: VoronoiState, latest: readonly ShareCell[], now: number, chunk = SEARCH_CHUNK): RoundResult {
  const fit = fitLayout(state.layout, latest);
  if (state.search) {
    const search = membership(state.search.cells) === membership(latest)
      ? state.search
      : { ...state.search, cells: [...latest], next: 1, best: null, startedAt: now };
    return continueSearch(state, fit, search, latest, now, chunk);
  }

  const hard = newHardIssues(fit.assessment, fit.layout);
  const soft = softDegraded(fit.assessment.score, fit.layout.chosenScore);
  // 认可只管当下还在的那一处：消失过的问题再出现就算新出现，要逼重排。
  const accepted = fit.layout.accepted.filter((key) => fit.assessment.occurrences.includes(key));
  let next = accepted.length === fit.layout.accepted.length ? state : { ...state, layout: { ...state.layout, accepted } };
  if (fit.structureChanged) {
    const passed = hard.length === 0 && !soft;
    const layout = passed
      ? { ...fit.layout, accepted, chosenScore: fit.assessment.score, chosenAt: now }
      : { ...fit.layout, accepted };
    next = { ...next, layout, lastFailedSearchAt: null };
    if (passed) return { state: next, changed: true, event: { kind: "adapted" } };
  }
  if (hard.length === 0 && !soft) return { state: next, changed: next !== state, event: { kind: "steady" } };

  const retryAt = next.lastFailedSearchAt === null ? 0 : next.lastFailedSearchAt + FAILED_SEARCH_RETRY_MS;
  const cooldownAt = hard.length > 0 ? 0 : next.lastRelayoutAt + RELAYOUT_COOLDOWN_MS;
  const waitingUntil = Math.max(retryAt, cooldownAt);
  if (now < waitingUntil) return { state: next, changed: next !== state, event: { kind: "due", hard, soft, waitingUntil } };

  const search: SearchProgress = { cells: [...latest], next: 1, best: null, startedAt: now, hard: hard.length > 0 };
  return continueSearch(next, fitLayout(next.layout, latest), search, latest, now, chunk);
}
