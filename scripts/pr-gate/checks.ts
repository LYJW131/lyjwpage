import { PREVIEW_WATCH_PATHS, watches, workersFor, type Worker } from "../build-watch-paths.ts";
import { changedPaths, type CheckRun, type Client, type PrFile, type Status } from "./github.ts";

const BUILD_PREFIX = "Workers Builds: ";
export const COMMENT_CHECK = "Comment check (Jev)";

export function commentAdvice(runs: CheckRun[]) {
  const run = newestByName(runs).get(COMMENT_CHECK);
  if (run?.status !== "completed" || run.conclusion !== "neutral") return null;
  return `${COMMENT_CHECK}：${run.output?.title ?? "有新注释可能该删"}（建议，不挡合并）。逐条对照 AGENTS.md「文档与注释」判断删还是留：${run.html_url ?? ""}`;
}

export function newestByName(runs: CheckRun[]) {
  const newest = new Map<string, CheckRun>();
  for (const run of runs) {
    const current = newest.get(run.name);
    const key = [run.started_at ?? "", run.id ?? 0] as const;
    const currentKey = current ? ([current.started_at ?? "", current.id ?? 0] as const) : null;
    if (!currentKey || key[0] > currentKey[0] || (key[0] === currentKey[0] && key[1] > currentKey[1])) newest.set(run.name, run);
  }
  return newest;
}

const passed = (run: CheckRun) => run.status === "completed" && ["success", "neutral", "skipped"].includes(run.conclusion ?? "");
const built = (run: CheckRun) => run.status === "completed" && run.conclusion === "success";

export function summarizeChecks(runs: CheckRun[], statuses: Status[]) {
  const items = [
    ...[...newestByName(runs).values()].map((run) => ({
      name: run.name,
      result: run.status === "completed" ? run.conclusion ?? "unknown" : run.status,
      done: run.status === "completed",
      ok: passed(run),
      url: run.html_url ?? null,
    })),
    ...statuses.map((status) => ({
      name: status.context,
      result: status.state,
      done: status.state !== "pending",
      ok: status.state === "success",
      url: status.target_url ?? null,
    })),
  ];
  return {
    items: items.map(({ name, result }) => ({ name, result })),
    pending: items.filter((item) => !item.done).map((item) => item.name),
    failing: items.filter((item) => item.done && !item.ok).map(({ name, result, url }) => ({ name, result, url })),
  };
}

export type BuildGap = { worker: Worker; reason: string };

export async function buildCoverage({
  gh,
  files,
  head,
  headRuns,
  commits,
}: {
  gh: Pick<Client, "get">;
  files: string[];
  head: string;
  headRuns: CheckRun[];
  commits: string[];
}) {
  const expected = workersFor(files, PREVIEW_WATCH_PATHS);
  const missing: BuildGap[] = [];
  const carried: { worker: Worker; from: string }[] = [];
  const onHead = newestByName(headRuns);
  const absent = expected.filter((worker) => !onHead.has(BUILD_PREFIX + worker));
  for (const worker of expected) {
    const run = onHead.get(BUILD_PREFIX + worker);
    if (run && !built(run)) missing.push({ worker, reason: run.status === "completed" ? `head 上的构建结论是 ${run.conclusion}` : "head 上的构建还在跑" });
  }
  if (absent.length === 0) return { expected, missing, carried };

  // Cloudflare 按每次推送改到的文件决定建不建，最后一次推送只改了文档时 head 上就没有构建检查；往前找最近一次构建。
  const older = commits.filter((sha) => sha !== head).reverse();
  const olderRuns = await Promise.all(older.map(async (sha) => ({ sha, runs: newestByName((await gh.get<{ check_runs?: CheckRun[] }>(`commits/${sha}/check-runs?per_page=100`)).check_runs ?? []) })));
  for (const worker of absent) {
    const found = olderRuns.find(({ runs }) => runs.has(BUILD_PREFIX + worker));
    const run = found?.runs.get(BUILD_PREFIX + worker);
    if (!found || !run) {
      missing.push({ worker, reason: "PR 的提交上都没有它的构建检查" });
      continue;
    }
    const short = found.sha.slice(0, 7);
    if (!built(run)) {
      missing.push({ worker, reason: `head 上没有它的构建，最近一次在 ${short}，结论是 ${run.conclusion ?? run.status}` });
      continue;
    }
    const since = await gh.get<{ files?: PrFile[] }>(`compare/${found.sha}...${head}`);
    const paths = PREVIEW_WATCH_PATHS[worker];
    const touched = paths !== undefined && changedPaths(since.files ?? []).some((path) => watches(paths, path));
    if (touched) missing.push({ worker, reason: `${short} 之后的改动碰到了它的监视路径，head 上还没有它的构建（刚推送时可能还在排队）` });
    else carried.push({ worker, from: found.sha });
  }
  return { expected, missing, carried };
}
