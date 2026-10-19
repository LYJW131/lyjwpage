#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BUILD_WATCH_PATHS, PREVIEW_WATCH_PATHS, watches, workersFor, type Worker } from "./build-watch-paths.ts";
import { check as checkReceipt, PASSING_RANK, TRUSTED_AUTHOR_IDS } from "./verify-receipt.ts";

const REPO = "LYJW131/lyjwpage";
const API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;
const BUILD_PREFIX = "Workers Builds: ";
export const CODEX_MAX_ROUNDS = 3;
export const REQUIRED_CHECKS = ["check"];
const ONCE_PER_PR_REVIEWERS = ["claude", "devin"];
const BOTS: Record<string, string> = {
  "chatgpt-codex-connector[bot]": "codex",
  "devin-ai-integration[bot]": "devin",
  "claude[bot]": "claude",
  "cursor[bot]": "cursor",
};
const UI_PATHS = [/^src\/components\//, /^src\/app\/(?!api\/)/, /\.css$/, /^public\//, /^docs\/explainer\/v2\//];
const DOC_PATHS = [/\.md$/i, /^\.claude\/(?!.*\.(?:[cm]?[jt]sx?|py|sh)$)/, /^docs\//];

const HELP = `用法：NODE_USE_ENV_PROXY=1 node scripts/pr-gate.ts --pr <号> [--need <等级|none>] [--judge | --no-judge]

合并前一条命令读全 PR 的门槛状态，只读，输出一份 JSON；退出码 0 ready、1 不 ready 或读不到 GitHub、2 参数错。
ready 只管机器核得了的门槛；分档提示写着要 lyjw 看图点头的，点头另算（HUMAN.md「5. PR 与合并」）。

JSON 里有：
  head、draft、mergeable、labels / baselineException
  tier          按改动路径分档：docs（只改 md 与 .claude/ 下的非脚本文件）、ui（界面）、logic（逻辑）、ui+logic；
                决定默认的 --need 与 --judge，hint 写这一档的合并门槛
  checks        head 上每项检查（check run 与 commit status，同名只认最新），pending 与 failing 单列；
                REQUIRED_CHECKS 里的检查 head 上还没出现时不算 ready
  workersBuilds expected 是按 PR 改动与分支 Preview 的监视路径（scripts/build-watch-paths.ts）算出该有的构建，结论要是 success；
                head 上没有、但更早的提交上构建成功且之后的改动没碰到它的路径，记 carried；afterMerge 是合进 main 后会重建的 Worker
  threads       没解决的行内评审线程：发起人、严重度标记与归类、最后一条是不是 lyjw 的账号回的、链接；
                解决状态依次试 GraphQL、Claude Code 会话的 review_threads 路由，都不通时 resolvedKnown 为 false
  reviewers     每个评审机器人最后审的提交；Codex 另给已用轮数与上限（每次推送自动审一轮）。
                Claude review 只在开 PR 或转为待审时审一次，Devin 每个 PR 也只审一次，没盖住 head 不算缺；
                要判定时两家都得审过一次
  receipt       scripts/verify-receipt.ts check 的结果（--need、--judge 见下）
  ready / todo  todo 每条一句：缺什么、去哪做

选项：
  --pr <号>            PR 号（必填）
  --need <等级|none>   回执至少要到的等级，覆盖分档的默认（ui 要 live-ui-verified，logic 要 unit-test-verified，docs 不要回执）
  --judge / --no-judge 要不要等机器评审并要一条 PASS 的判定，覆盖分档的默认（logic 默认要）；
                       主线程判为小改动时用 --no-judge
  --help               显示本说明

回执与判定的补丁比对用本地 git：先 git fetch origin main。`;

type Init = { method?: string; headers: Record<string, string>; body?: string; signal: AbortSignal };
type FetchLike = (url: string, init: Init) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
type PatchId = (sha: string) => string | null;
type User = { login?: string; id?: number } | null | undefined;

type Pull = {
  number: number;
  title: string;
  state: string;
  merged?: boolean;
  draft?: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  head: { sha: string };
  labels?: { name: string }[];
};
type PrFile = { filename: string; previous_filename?: string };
export type CheckRun = { id?: number; name: string; status: string; conclusion: string | null; started_at?: string | null; html_url?: string };
type Status = { context: string; state: string; target_url?: string | null };
type Review = { user?: User; commit_id?: string | null };
type ReviewComment = {
  id: number;
  in_reply_to_id?: number;
  user?: User;
  body?: string | null;
  html_url?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  created_at?: string;
};
type IssueComment = { user?: User; body?: string | null };
type Resolution = { source: "graphql" | "ccr" | "rest"; byRoot: Map<number, { resolved: boolean; outdated: boolean }> | null };

export type Level = "blocking" | "security" | "normal" | "optional" | "pre-existing" | "info" | "unmarked";

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

function client(fetchImpl: FetchLike) {
  const request = async <T>(url: string, init: Partial<Init> = {}): Promise<T> => {
    const response = await fetchImpl(url, { ...init, headers: headers(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${url.replace(API, "")} HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  const get = <T>(path: string) => request<T>(`${API}/repos/${REPO}/${path}`);
  const all = async <T>(path: string): Promise<T[]> => {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await get<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  };
  const graphql = (query: string, variables: Record<string, unknown>) =>
    request<{ data?: unknown; errors?: unknown }>(`${API}/graphql`, { method: "POST", body: JSON.stringify({ query, variables }) });
  return { get, all, graphql };
}
type Client = ReturnType<typeof client>;

export function tierOf(files: string[]) {
  const ui = files.filter((file) => UI_PATHS.some((re) => re.test(file)));
  const logic = files.filter((file) => !ui.includes(file) && !DOC_PATHS.some((re) => re.test(file)));
  const name = ui.length > 0 && logic.length > 0 ? "ui+logic" : ui.length > 0 ? "ui" : logic.length > 0 ? "logic" : "docs";
  const hints: string[] = [];
  if (name === "docs") hints.push("只改文档与 skill：CI 绿、线程解决了就合，不要回执、不等机器评审");
  if (ui.length > 0) hints.push("碰到界面：回执要 live-ui-verified，合并前要 lyjw 看图点头（ready 不含这一项）；lyjw 明确要求的小改动除外");
  if (logic.length > 0) hints.push("改了逻辑：默认按大改算，等机器评审与判定；主线程判为小改动时加 --no-judge");
  return {
    name,
    ui,
    logic,
    need: ui.length > 0 ? "live-ui-verified" : logic.length > 0 ? "unit-test-verified" : null,
    judge: logic.length > 0,
    hint: hints.join("；"),
  };
}

function firstLine(body: string) {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim().split("\n", 1)[0] ?? "";
}

// 各家标记：Codex 是 P0–P3 徽章；Claude review 是 🔴 / 🟡 nit / 🟣 既有问题；Devin 是 🔴 / 🟡 bug、🟥 / 🟨 security、🔍 / 📝 说明，
// 种类写在开头的 HTML 注释里。红圈永不算可选，所以先认 🔴，再看「(optional)」之类的字样。
export function severityOf(body: string, bot: string | null): { mark: string | null; level: Level } {
  const devinKind = /"kind":\s*"(\w+)"/.exec(body)?.[1] ?? null;
  const head = firstLine(body);
  const badge = /!\[(P[0-3]) Badge\]/.exec(head)?.[1];
  if (badge) return { mark: badge, level: badge === "P0" || badge === "P1" ? "blocking" : badge === "P2" ? "normal" : "optional" };
  const emoji = /🔴|🟥|🟨|🟣|🟡|🔍|📝/u.exec(head)?.[0] ?? null;
  if (devinKind === "security" || emoji === "🟥" || emoji === "🟨") return { mark: emoji ?? "security", level: "security" };
  if (emoji === "🔴") return { mark: emoji, level: "blocking" };
  if (emoji === "🟣") return { mark: emoji, level: "pre-existing" };
  if (emoji === "🟡") return { mark: emoji, level: bot === "claude" || /\(optional\)|\bnit\b/i.test(head) ? "optional" : "normal" };
  if (emoji) return { mark: emoji, level: "info" };
  const label = /\b(blocker|critical|high|security|nit|minor|optional)\b/i.exec(head)?.[1]?.toLowerCase();
  if (!label) return { mark: null, level: "unmarked" };
  if (label === "security") return { mark: label, level: "security" };
  return { mark: label, level: ["nit", "minor", "optional"].includes(label) ? "optional" : "blocking" };
}

function shortTitle(body: string) {
  const text = firstLine(body)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*/g, "")
    .trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export function buildThreads(comments: ReviewComment[], resolution: Resolution) {
  const byRoot = new Map<number, ReviewComment[]>();
  const ordered = [...comments].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id - b.id);
  for (const comment of ordered) {
    const root = comment.in_reply_to_id ?? comment.id;
    const thread = byRoot.get(root) ?? [];
    thread.push(comment);
    byRoot.set(root, thread);
  }
  const unresolved = [];
  for (const [root, thread] of byRoot) {
    const state = resolution.byRoot?.get(root) ?? null;
    if (state?.resolved) continue;
    const first = thread[0];
    const last = thread[thread.length - 1];
    unresolved.push({
      by: first.user?.login ?? null,
      ...severityOf(first.body ?? "", BOTS[first.user?.login ?? ""] ?? null),
      title: shortTitle(first.body ?? ""),
      lastBy: last.user?.login ?? null,
      lastByLyjw: TRUSTED_AUTHOR_IDS.has(last.user?.id ?? 0),
      outdated: state?.outdated ?? null,
      path: first.path ?? null,
      line: first.line ?? first.original_line ?? null,
      url: first.html_url ?? null,
    });
  }
  return { source: resolution.source, resolvedKnown: resolution.byRoot !== null, total: byRoot.size, unresolved };
}

async function threadResolution(gh: Client, pr: number): Promise<Resolution> {
  try {
    const query = `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){
      reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){nodes{databaseId}}}}}}}`;
    const [owner, name] = REPO.split("/");
    const result = (await gh.graphql(query, { owner, name, pr })) as {
      data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: { isResolved: boolean; isOutdated: boolean; comments: { nodes: { databaseId: number }[] } }[] } } } };
    };
    const nodes = result.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (!nodes) throw new Error("graphql 没有 reviewThreads");
    const byRoot = new Map(nodes.map((node) => [node.comments.nodes[0]?.databaseId ?? 0, { resolved: node.isResolved, outdated: node.isOutdated }]));
    return { source: "graphql", byRoot };
  } catch {}
  // Claude Code 会话拦 GraphQL，给了这条只读路由代替；会话外它不存在。
  try {
    const threads = await gh.get<{ resolved: boolean; outdated: boolean; comment_ids: number[] }[]>(`pulls/${pr}/ccr/review_threads`);
    const byRoot = new Map(threads.map((thread) => [Math.min(...thread.comment_ids), { resolved: thread.resolved, outdated: thread.outdated }]));
    return { source: "ccr", byRoot };
  } catch {}
  return { source: "rest", byRoot: null };
}

function newestByName(runs: CheckRun[]) {
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

function summarizeChecks(runs: CheckRun[], statuses: Status[]) {
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

type BuildGap = { worker: Worker; reason: string };

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

function changedPaths(files: PrFile[]) {
  return files.flatMap((file) => (file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]));
}

type CodexState = { commit_sha?: string | null; status?: string | null };

function codexState(comments: IssueComment[]): CodexState | null {
  let state: CodexState | null = null;
  for (const comment of comments) {
    if (BOTS[comment.user?.login ?? ""] !== "codex") continue;
    const match = /<!-- codex-review-state:v1 (\{.*?\}) -->/.exec(comment.body ?? "");
    if (!match) continue;
    try {
      state = (JSON.parse(match[1]) as { code_review?: CodexState }).code_review ?? state;
    } catch {}
  }
  return state;
}

export type Reviewer = {
  bot: string;
  reviews: number;
  rounds?: number;
  maxRounds?: number;
  status?: string | null;
  statusCommit?: string | null;
  lastReviewed: string | null;
  coversHead: boolean;
};

export function reviewerSummary(reviews: Review[], comments: IssueComment[], head: string): Reviewer[] {
  const reviewers: Reviewer[] = [];
  for (const [login, bot] of Object.entries(BOTS)) {
    const own = reviews.filter((review) => review.user?.login === login && review.commit_id);
    const commented = comments.some((comment) => comment.user?.login === login);
    if (own.length === 0 && !commented) continue;
    let lastReviewed = own.at(-1)?.commit_id ?? null;
    let codex = {};
    if (bot === "codex") {
      const state = codexState(comments);
      const rounds = new Set(own.map((review) => review.commit_id));
      // 没意见的一轮只回个 👍、不留评审，只能从汇总评论里那份状态看出来。
      if (state?.status === "completed" && state.commit_sha) {
        rounds.add(state.commit_sha);
        lastReviewed = state.commit_sha;
      }
      codex = { rounds: rounds.size, maxRounds: CODEX_MAX_ROUNDS, status: state?.status ?? null, statusCommit: state?.commit_sha ?? null };
    }
    reviewers.push({ bot, reviews: own.length, ...codex, lastReviewed, coversHead: lastReviewed === head });
  }
  return reviewers;
}

function decide({
  pull,
  tier,
  checks,
  builds,
  threads,
  reviewers,
  receipt,
  judge,
}: {
  pull: Pull;
  tier: ReturnType<typeof tierOf>;
  checks: ReturnType<typeof summarizeChecks>;
  builds: { missing: BuildGap[] };
  threads: ReturnType<typeof buildThreads>;
  reviewers: Reviewer[];
  receipt: { pass: boolean; next: string | null } | null;
  judge: boolean;
}) {
  const todo: string[] = [];
  const notes: string[] = [];
  if (pull.merged) todo.push("PR 已经合并：门槛不用再过");
  else if (pull.state !== "open") todo.push("PR 已关闭：要合先重新打开");
  if (pull.draft) todo.push("PR 还是草稿：确认要合时在 PR 页面转为待审（Ready for review）");
  if (pull.mergeable === false || pull.mergeable_state === "dirty") todo.push("和 main 有冲突：把 main 合进分支解决冲突（merge，不 rebase）");
  else if (pull.mergeable === null && pull.state === "open") todo.push("GitHub 还没算出能不能合并：过一会儿重跑本命令");
  for (const name of REQUIRED_CHECKS) {
    if (!checks.items.some((item) => item.name === name)) todo.push(`head 上还没有「${name}」检查：CI 可能还在排队，等它出现并跑完（带上限）再重跑本命令`);
  }
  if (checks.pending.length > 0) todo.push(`head 上还有检查在跑：${checks.pending.join("、")}；等它们跑完（带上限）再重跑本命令`);
  for (const failing of checks.failing) todo.push(`检查「${failing.name}」结论是 ${failing.result}：看 ${failing.url ?? "PR 的 Checks 页"} 找原因，修好再推`);
  for (const gap of builds.missing) todo.push(`该有的 Workers Builds: ${gap.worker} 没过：${gap.reason}；去 Cloudflare 看 ${gap.worker} 的分支构建`);
  if (!threads.resolvedKnown) {
    todo.push(`拿不到评审线程的解决状态（${threads.total} 条线程）：去 PR 的 Files changed 页逐条核对`);
  } else if (threads.unresolved.length > 0) {
    const answered = threads.unresolved.filter((thread) => thread.lastByLyjw).length;
    const blocking = threads.unresolved.filter((thread) => thread.level === "blocking" || thread.level === "security").length;
    todo.push(
      `还有 ${threads.unresolved.length} 条评审线程没解决（${blocking} 条红圈、P0/P1 或安全类；${answered} 条最后是我们回的，确认改了就点解决）：见 threads.unresolved，逐条改或回复理由后解决`,
    );
  }
  if (judge) {
    const codex = reviewers.find((reviewer) => reviewer.bot === "codex");
    if (codex && (codex.rounds ?? 0) >= CODEX_MAX_ROUNDS) notes.push(`Codex 已审 ${codex.rounds} 轮，到上限了，不再等它`);
    else if (codex?.status === "failed") notes.push("Codex 最近一轮没审成（多半是额度用完）：不等它，额度恢复后可在 PR 评论 @codex review");
    else if (!codex?.coversHead) todo.push(`Codex 还没审到 head（已用 ${codex?.rounds ?? 0}/${CODEX_MAX_ROUNDS} 轮，每次推送自动审一轮）：等它审完处理新意见，等待上限照 lyjwpage-verify「等待要有上限」`);
    for (const bot of ONCE_PER_PR_REVIEWERS) {
      if (!reviewers.some((reviewer) => reviewer.bot === bot)) todo.push(`${bot} 还没评审这个 PR（每个 PR 只审一次）：等它，等待上限照 lyjwpage-verify「等待要有上限」；超时在汇报里记它没跑成，不算通过`);
    }
  }
  if (receipt && !receipt.pass) todo.push(receipt.next ?? "回执或判定没通过：见 receipt");
  if (tier.ui.length > 0) notes.push("碰到界面：合并前还要 lyjw 看图点头，脚本不判断这一项");
  return { notes, ready: todo.length === 0, todo };
}

export async function gate(
  { pr, need, judge }: { pr: number; need?: string | null; judge?: boolean },
  deps: { fetch?: FetchLike; patchId?: PatchId } = {},
) {
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const gh = client(fetchImpl);
  const pull = await gh.get<Pull>(`pulls/${pr}`);
  const head = pull.head.sha;
  const [files, commits, reviews, reviewComments, issueComments, runs, status, resolution] = await Promise.all([
    gh.all<PrFile>(`pulls/${pr}/files`),
    gh.all<{ sha: string }>(`pulls/${pr}/commits`),
    gh.all<Review>(`pulls/${pr}/reviews`),
    gh.all<ReviewComment>(`pulls/${pr}/comments`),
    gh.all<IssueComment>(`issues/${pr}/comments`),
    gh.get<{ check_runs?: CheckRun[] }>(`commits/${head}/check-runs?per_page=100`),
    gh.get<{ statuses?: Status[] }>(`commits/${head}/status`),
    threadResolution(gh, pr),
  ]);
  const paths = changedPaths(files);
  const tier = tierOf(paths);
  const wantNeed = need === undefined ? tier.need : need;
  const wantJudge = judge ?? tier.judge;
  const [builds, receipt] = await Promise.all([
    buildCoverage({ gh, files: paths, head, headRuns: runs.check_runs ?? [], commits: commits.map((commit) => commit.sha) }),
    wantNeed === null
      ? Promise.resolve(null)
      : checkReceipt({ pr, need: wantNeed, wantJudge }, { fetch: fetchImpl, patchId: deps.patchId }).then(
          (result) => ({ need: wantNeed, wantJudge, pass: result.pass, next: result.next, latest: result.receipt, judge: result.judge }),
          (error: Error) => ({ need: wantNeed, wantJudge, pass: false, next: `读不到回执（${error.message}）；云端要加 NODE_USE_ENV_PROXY=1`, latest: null, judge: null }),
        ),
  ]);
  const checks = summarizeChecks(runs.check_runs ?? [], status.statuses ?? []);
  const threads = buildThreads(reviewComments, resolution);
  const reviewers = reviewerSummary(reviews, issueComments, head);
  const labels = (pull.labels ?? []).map((label) => label.name);
  const verdict = decide({ pull, tier, checks, builds, threads, reviewers, receipt, judge: wantJudge });
  return {
    pr,
    title: pull.title,
    state: pull.merged ? "merged" : pull.state,
    head,
    draft: pull.draft ?? false,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state ?? null,
    labels,
    baselineException: labels.includes("baseline-exception"),
    tier: { ...tier, need: wantNeed, judge: wantJudge },
    checks,
    workersBuilds: { ...builds, afterMerge: workersFor(paths, BUILD_WATCH_PATHS) },
    threads,
    reviewers,
    receipt,
    ...verdict,
  };
}

const USAGE = "用法：--pr <号> [--need <等级|none>] [--judge | --no-judge]；见 --help";

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowNegative: true,
      options: { pr: { type: "string" }, need: { type: "string" }, judge: { type: "boolean" }, help: { type: "boolean", default: false } },
    }));
  } catch {
    console.log(JSON.stringify({ ready: false, todo: [USAGE] }));
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const pr = Number(values.pr);
  if (!Number.isInteger(pr) || pr <= 0 || (values.need !== undefined && values.need !== "none" && !Object.hasOwn(PASSING_RANK, values.need))) {
    console.log(JSON.stringify({ ready: false, todo: [USAGE] }));
    return 2;
  }
  try {
    const result = await gate({ pr, need: values.need === "none" ? null : values.need, judge: values.judge });
    console.log(JSON.stringify(result, null, 2));
    return result.ready ? 0 : 1;
  } catch (error) {
    const reason = (error as Error).message;
    console.log(JSON.stringify({ pr, ready: false, error: reason, todo: [`读不到 GitHub（${reason}）：云端要加 NODE_USE_ENV_PROXY=1，或设 GITHUB_TOKEN 后重跑`] }, null, 2));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
