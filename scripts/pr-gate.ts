#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BUILD_WATCH_PATHS, workersFor } from "./build-watch-paths.ts";
import { buildCoverage, summarizeChecks } from "./pr-gate/checks.ts";
import { decide } from "./pr-gate/decide.ts";
import { changedPaths, client, isTrustedAuthor, type CheckRun, type FetchLike, type PatchId, type PrFile, type Pull, type Review, type ReviewComment, type IssueComment, type Status } from "./pr-gate/github.ts";
import { reviewerSummary } from "./pr-gate/reviewers.ts";
import { buildThreads, threadResolution } from "./pr-gate/threads.ts";
import { judgeAsked, tierOf, verifierFiles } from "./pr-gate/tier.ts";
import { ruleDrift } from "./rule-drift.ts";
import { check as checkReceipt, PASSING_RANK } from "./verify-receipt.ts";

export { buildCoverage } from "./pr-gate/checks.ts";
export { REQUIRED_CHECKS } from "./pr-gate/decide.ts";
export type { CheckRun } from "./pr-gate/github.ts";
export { CODEX_MAX_ROUNDS, reviewerSummary, type Reviewer } from "./pr-gate/reviewers.ts";
export { buildThreads, severityOf, type Level } from "./pr-gate/threads.ts";
export { tierOf } from "./pr-gate/tier.ts";

const HELP = `用法：NODE_USE_ENV_PROXY=1 node scripts/pr-gate.ts --pr <号> [--need <等级|none>] [--judge | --no-judge]

合并前一条命令读全 PR 的门槛状态，只读，输出一份 JSON；退出码 0 ready、1 不 ready 或读不到 GitHub、2 参数错。
ready 只管机器核得了的门槛；分档提示写着要 lyjw 看图点头的，点头另算（HUMAN.md「5. PR 与合并」）。

JSON 里有：
  head、draft、mergeable、labels / baselineException
  author        PR 作者的 login、数字 id、是不是 lyjw 的账号（trusted）；不是的整个 PR 按逻辑档走回执与判定，--need、--no-judge 不放行
  tier          按改动路径分档：docs（只改 md 与 .claude/ 下的非可执行文件）、ui（界面）、logic（逻辑，含 .claude 的 settings、launch、hooks、feature-map，
                docs/ 下的脚本与依赖清单，public/ 下的 js、html、svg、xml、_headers）、ui+logic；
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
  ruleDrift     分支起点（PR 第一个提交的父提交）以来 main 上改过的规则文件（AGENTS.md、DESIGN.md、HUMAN.md、REVIEW.md、.claude/skills/ 与 .claude/rules/ 下的 md）；
                不为空时 notes 提示对一遍新规则，不影响 ready
  ready / todo  todo 每条一句：缺什么、去哪做

选项：
  --pr <号>            PR 号（必填）
  --need <等级|none>   回执至少要到的等级，覆盖分档的默认（ui 要 live-ui-verified，logic 要 unit-test-verified，docs 不要回执）；作者不是 lyjw 的账号时不生效
  --judge / --no-judge 要不要等机器评审并要一条 PASS 的判定，覆盖默认（PR 贴了 needs-judge 标签才要）；
                       作者不是 lyjw 的账号时不生效。
                       --need 只改这份输出：合并钩子 guard-merge-method.ts 照分档默认的等级要回执
  --help               显示本说明

回执与判定的补丁比对用本地 git：先 git fetch origin main。`;

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
    gh.all<{ sha: string; parents?: { sha: string }[] }>(`pulls/${pr}/commits`),
    gh.all<Review>(`pulls/${pr}/reviews`),
    gh.all<ReviewComment>(`pulls/${pr}/comments`),
    gh.all<IssueComment>(`issues/${pr}/comments`),
    gh.get<{ check_runs?: CheckRun[] }>(`commits/${head}/check-runs?per_page=100`),
    gh.get<{ statuses?: Status[] }>(`commits/${head}/status`),
    threadResolution(gh, pr),
  ]);
  const paths = changedPaths(files);
  const trustedAuthor = isTrustedAuthor(pull);
  const tier = tierOf(paths, { trustedAuthor, judgeAsked: judgeAsked(pull) });
  const wantNeed = trustedAuthor && need !== undefined ? need : tier.need;
  const wantJudge = trustedAuthor ? (judge ?? tier.judge) : true;
  const [builds, receipt, rules] = await Promise.all([
    buildCoverage({ gh, files: paths, head, headRuns: runs.check_runs ?? [], commits: commits.map((commit) => commit.sha) }),
    wantNeed === null
      ? Promise.resolve(null)
      : checkReceipt({ pr, need: wantNeed, wantJudge }, { fetch: fetchImpl, patchId: deps.patchId }).then(
          (result) => ({ need: wantNeed, wantJudge, pass: result.pass, next: result.next, latest: result.receipt, judge: result.judge }),
          (error: Error) => ({ need: wantNeed, wantJudge, pass: false, next: `读不到回执（${error.message}）；云端要加 NODE_USE_ENV_PROXY=1`, latest: null, judge: null }),
        ),
    ruleDrift(gh, commits, pull.base?.ref ?? "main"),
  ]);
  const checks = summarizeChecks(runs.check_runs ?? [], status.statuses ?? []);
  const threads = buildThreads(reviewComments, resolution);
  const reviewers = reviewerSummary(reviews, issueComments, head);
  const labels = (pull.labels ?? []).map((label) => label.name);
  const verdict = decide({ pull, tier, checks, builds, threads, reviewers, receipt, judge: wantJudge });
  const changedVerifier = verifierFiles(paths);
  if (changedVerifier.length > 0) verdict.notes.push(`这个 PR 改了验证员本身（${changedVerifier.join("、")}）：pull_request 触发的 Verify Action 里验证与判定跑的是分支上的这份（签发的 publish 只跑 main 上的脚本），结论出自被改过的验证员，合并前交 lyjw 看一眼`);
  if (rules.files.length > 0) verdict.notes.push(`分支开工后 main 上改了规则文件（${rules.files.join("、")}）：重读改动的部分，拿 PR 的改动对一遍新规则`);
  return {
    pr,
    title: pull.title,
    state: pull.merged ? "merged" : pull.state,
    head,
    draft: pull.draft ?? false,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state ?? null,
    author: { login: pull.user?.login ?? null, id: pull.user?.id ?? null, trusted: trustedAuthor },
    labels,
    baselineException: labels.includes("baseline-exception"),
    tier: { ...tier, need: wantNeed, judge: wantJudge },
    checks,
    workersBuilds: { ...builds, afterMerge: workersFor(paths, BUILD_WATCH_PATHS) },
    threads,
    reviewers,
    receipt,
    ruleDrift: rules,
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

