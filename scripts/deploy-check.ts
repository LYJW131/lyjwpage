#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const REPO = "LYJW131/lyjwpage";
const HOSTS = ["lyjw.me", "lyjw131.com"];
const BUILD_PREFIX = "Workers Builds: ";
const REQUEST_TIMEOUT_MS = 30_000;

const HELP = `用法：node scripts/deploy-check.ts --sha <合并提交完整 sha> [选项]

合并后的部署核对：等合并提交上的 Workers Builds 检查跑完，site 重建了就等两个生产域名的
/api/version 跟上这个提交。输出 JSON，失败时 next 写下一步；退出码 0 通过、1 不通过、2 参数错。

选项：
  --sha <sha>          合并提交的完整 40 位 sha（必填）
  --timeout <秒>       总等待上限，默认 600
  --interval <秒>      轮询间隔，默认 20
  --build-grace <秒>   多久内没出现 site 的构建检查就当这次没碰到 site，默认 180
  --site auto|yes|no   是否等 /api/version；auto 按有没有 site 的构建检查判断，默认 auto
  --expect <a,b>       这次合并碰到了哪些 Worker 的监视路径（如 site,core）；列出的每个都要构建成功才算通过
  --help               显示本说明

GitHub 有 GITHUB_TOKEN / GH_TOKEN 时带上，没有就匿名读（公开仓库）。
云端容器的出站要走代理：NODE_USE_ENV_PROXY=1 node scripts/deploy-check.ts …，否则请求不经代理会 401 或连不上。
判断「被更新的部署覆盖」用 GitHub 的提交比较接口，不依赖本地 git 有没有那个提交。`;

type Flags = Record<string, string | true>;

export type CheckRun = { name: string; status: string; conclusion: string | null; started_at?: string | null; id?: number };
export type Build = { worker: string; status: string; conclusion: string | null };
type VersionState = "unreadable" | "live" | "superseded" | "stale";
type IsAncestor = (ancestor: string, descendant: string) => Promise<boolean>;
type FetchResponse = { ok: boolean; status?: number; json(): Promise<unknown> };
type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<FetchResponse>;

export type RunOptions = {
  sha: string;
  timeoutMs: number;
  intervalMs: number;
  graceMs: number;
  site: string;
  expect?: string[];
};

export type RunDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  isAncestor?: IsAncestor;
};

export type RunResult = {
  sha: string;
  builds: Build[];
  versions: { host: string; commit: string | null; state: VersionState }[];
  pass: boolean;
  next: string | null;
  siteChecked?: boolean;
  note?: string;
};

export function parseArgs(argv: string[]) {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return flags;
}

// 同一提交重跑构建后，旧的失败检查和新的检查同名并存，每个 Worker 只认最新那条。
function newestPerWorker(checkRuns: CheckRun[]): Build[] {
  const newest = new Map<string, { key: [string, number]; run: CheckRun }>();
  for (const run of checkRuns) {
    if (!run.name.startsWith(BUILD_PREFIX)) continue;
    const worker = run.name.slice(BUILD_PREFIX.length);
    const current = newest.get(worker);
    const key: [string, number] = [run.started_at ?? "", run.id ?? 0];
    if (!current || key[0] > current.key[0] || (key[0] === current.key[0] && key[1] > current.key[1])) {
      newest.set(worker, { key, run });
    }
  }
  return [...newest].map(([worker, { run }]) => ({ worker, status: run.status, conclusion: run.conclusion }));
}

export function summarizeBuilds(checkRuns: CheckRun[]) {
  const builds = newestPerWorker(checkRuns);
  const pending = builds.filter((build) => build.status !== "completed");
  const failed = builds.filter(
    (build) => build.status === "completed" && !["success", "neutral", "skipped"].includes(build.conclusion ?? ""),
  );
  const site = builds.find((build) => build.worker === "site");
  return { builds, pending, failed, siteBuilt: site?.status === "completed" && site.conclusion === "success" };
}

// commit 等于目标：已上线；目标是 commit 的祖先：被之后的部署覆盖，同样算通过；否则还停在旧版本。
export async function classifyVersion(commit: string | null, sha: string, isAncestor: IsAncestor): Promise<VersionState> {
  if (!commit) return "unreadable";
  if (commit === sha) return "live";
  if (await isAncestor(sha, commit)) return "superseded";
  return "stale";
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

// 用 GitHub 比较而不是本地 git：轮询期间新合并的提交本地还没有，merge-base 会把它误判成旧提交。
function githubIsAncestor(fetchImpl: FetchLike, signal: () => AbortSignal): IsAncestor {
  return async (ancestor, descendant) => {
    try {
      const response = await fetchImpl(
        `https://api.github.com/repos/${REPO}/compare/${ancestor}...${descendant}?per_page=1`,
        { headers: githubHeaders(), signal: signal() },
      );
      if (!response.ok) return false;
      return ((await response.json()) as { status?: string }).status === "ahead";
    } catch {
      return false;
    }
  };
}

async function fetchCheckRuns(sha: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<CheckRun[]> {
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/commits/${sha}/check-runs?per_page=100`, {
    headers: githubHeaders(),
    signal,
  });
  if (!response.ok) throw new Error(`check-runs HTTP ${response.status}`);
  return ((await response.json()) as { check_runs?: CheckRun[] }).check_runs ?? [];
}

async function fetchVersion(host: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetchImpl(`https://${host}/api/version`, { headers: { "cache-control": "no-cache" }, signal });
    if (!response.ok) return null;
    return ((await response.json()) as { commit?: string | null }).commit ?? null;
  } catch {
    return null;
  }
}

export async function run(options: RunOptions, deps: RunDeps = {}): Promise<RunResult> {
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const wait = deps.sleep ?? sleep;
  const now = deps.now ?? Date.now;
  const { sha, timeoutMs, intervalMs, graceMs, site, expect = [] } = options;
  const startedAt = now();
  const elapsed = () => now() - startedAt;
  const requestSignal = () => AbortSignal.timeout(Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, timeoutMs - elapsed())));
  const isAncestor = deps.isAncestor ?? githubIsAncestor(fetchImpl, requestSignal);

  let summary: ReturnType<typeof summarizeBuilds> = { builds: [], pending: [], failed: [], siteBuilt: false };
  let buildError: string | null;
  for (;;) {
    buildError = null;
    try {
      summary = summarizeBuilds(await fetchCheckRuns(sha, fetchImpl, requestSignal()));
    } catch (error) {
      buildError = String((error as { message?: unknown } | null)?.message ?? error);
    }
    const graceOver = elapsed() >= graceMs;
    const settled = !buildError && summary.pending.length === 0 && (summary.builds.length > 0 || graceOver);
    const seen = new Set(summary.builds.map((build) => build.worker));
    const expectedSeen = expect.every((worker) => seen.has(worker));
    if (settled && expectedSeen && (seen.has("site") || site !== "auto" || graceOver)) break;
    if (elapsed() >= timeoutMs) break;
    await wait(intervalMs);
  }

  const result: RunResult = { sha, builds: summary.builds, versions: [], pass: false, next: null };
  if (buildError) {
    result.next = `读不到合并提交的检查（${buildError}）；确认 sha 是 main 上的合并提交，或设 GITHUB_TOKEN 后重跑`;
    return result;
  }
  if (summary.pending.length > 0) {
    result.next = `构建超时仍在跑：${summary.pending.map((b) => b.worker).join("、")}；去 Cloudflare 看构建日志，别手跑 wrangler deploy`;
    return result;
  }
  const missing = expect.filter(
    (worker) => !summary.builds.some((build) => build.worker === worker && build.conclusion === "success"),
  );
  if (missing.length > 0) {
    result.next = `预期要构建的 Worker 没有成功的构建检查：${missing.join("、")}；去 Cloudflare 看这几个 Worker 的构建列表`;
    return result;
  }
  if (summary.failed.length > 0) {
    result.next = `构建失败：${summary.failed.map((b) => `${b.worker}=${b.conclusion}`).join("、")}；看 Workers Builds 日志找根因，修了再推`;
    return result;
  }

  const waitVersion = site === "yes" || (site === "auto" && summary.siteBuilt);
  result.siteChecked = waitVersion;
  if (!waitVersion) {
    result.pass = true;
    if (summary.builds.length === 0) result.note = "宽限期内没有任何 Workers Builds 检查，这次合并没碰到 Worker 的监视路径；碰到了的话用 --expect 列出来";
    return result;
  }

  for (;;) {
    const versions: RunResult["versions"] = [];
    for (const host of HOSTS) {
      const commit = await fetchVersion(host, fetchImpl, requestSignal());
      versions.push({ host, commit, state: await classifyVersion(commit, sha, isAncestor) });
    }
    result.versions = versions;
    if (versions.every((v) => v.state === "live" || v.state === "superseded")) {
      result.pass = true;
      return result;
    }
    if (elapsed() >= timeoutMs) break;
    await wait(intervalMs);
  }
  const behind = result.versions.filter((v) => v.state !== "live" && v.state !== "superseded");
  result.next = `${behind.map((v) => `${v.host}=${v.commit ?? "读不到"}`).join("、")} 仍不是这次合并或之后的提交；多半是并行构建让旧提交后完成。是否给 main 重跑 site 构建是生产动作，交 lyjw 决定`;
  return result;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  const sha = typeof flags.sha === "string" ? flags.sha : "";
  const site = flags.site ?? "auto";
  if (!/^[0-9a-f]{40}$/.test(sha) || typeof site !== "string" || !["auto", "yes", "no"].includes(site)) {
    console.log(JSON.stringify({ pass: false, next: "需要 --sha <40 位小写 sha>，--site 只能是 auto|yes|no；见 --help" }));
    return 2;
  }
  const seconds = (value: string | true | undefined, fallback: number) => (Number(value) > 0 ? Number(value) : fallback) * 1000;
  const result = await run({
    sha,
    site,
    timeoutMs: seconds(flags.timeout, 600),
    intervalMs: seconds(flags.interval, 20),
    graceMs: seconds(flags["build-grace"], 180),
    expect: typeof flags.expect === "string" ? flags.expect.split(",").map((w) => w.trim()).filter(Boolean) : [],
  });
  console.log(JSON.stringify(result, null, 2));
  return result.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
