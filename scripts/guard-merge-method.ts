#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { mergeMethodFor } from "./merge-message.ts";
import { commentAdvice } from "./pr-gate/checks.ts";
import { changedPaths, client, type CheckRun, type FetchLike, type PatchId, type PrFile, type Pull } from "./pr-gate/github.ts";
import { check as checkReceipt } from "./verify-receipt.ts";
import { prTier } from "./verify-receipt/notes-only.ts";

const REPO = { owner: "lyjw131", repo: "lyjwpage" };

type MergeInput = { owner?: unknown; repo?: unknown; pullNumber?: unknown; merge_method?: unknown; expectedHeadSha?: unknown };

export const DO_NOT_MERGE_LABEL = "do-not-merge";

const countCommits = (sha: string, cwd: string) =>
  Number(execFileSync("git", ["rev-list", "--count", "--no-merges", `origin/main..${sha}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());

const labelsOf = (pr: number) =>
  JSON.parse(
    execFileSync("gh", ["api", `repos/${REPO.owner}/${REPO.repo}/issues/${pr}/labels`, "--jq", "[.[].name]"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as string[];

const isLyjwpage = (input: MergeInput) => String(input.owner).toLowerCase() === REPO.owner && String(input.repo).toLowerCase() === REPO.repo;

export function mergeMethodReason(input: MergeInput, count: (sha: string) => number, labels: (pr: number) => string[] = () => []): string | null {
  if (!isLyjwpage(input)) return null;
  const sha = input.expectedHeadSha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) {
    return "合并 lyjwpage 的 PR 要带 pnpm merge-message 给的 expectedHeadSha（40 位）。";
  }
  let commits: number;
  try {
    commits = count(sha);
  } catch {
    return `本地数不出 origin/main..${sha} 的提交：先 git fetch origin main，在 PR 分支上跑 pnpm merge-message，再合并。`;
  }
  if (!Number.isInteger(commits) || commits < 1) {
    return `origin/main..${sha} 里没有非合并提交：先 git fetch origin main 再跑 pnpm merge-message。`;
  }
  const pr = Number(input.pullNumber);
  if (!Number.isInteger(pr) || pr <= 0) return "合并调用里没有 PR 号（pullNumber）。";
  let current: string[];
  try {
    current = labels(pr);
  } catch {
    return `读不到 #${pr} 的标签，判不了是不是 ${DO_NOT_MERGE_LABEL} 的测试 PR：先 gh auth status 确认 gh 已登录，再合并。`;
  }
  if (current.includes(DO_NOT_MERGE_LABEL)) {
    return `#${pr} 带着 ${DO_NOT_MERGE_LABEL} 标签（一次性测试 PR）：不合，用完关掉；确实要合，先摘掉标签。`;
  }
  const expected = mergeMethodFor(commits);
  if (input.merge_method === expected) return null;
  return `这个 PR 有 ${commits} 个非合并提交，merge_method 要用 ${expected}（少于 3 个压缩合并，3 个及以上用合并提交），照 pnpm merge-message 输出的 merge_method 传。`;
}

// 回执等级按分档的默认门槛查，不收 pr-gate 的 --need；判定只在 PR 贴了 needs-judge 标签或作者不是 lyjw 的账号时要。
// 回执不够只提醒不拦：验证员会一直标出已接受的取舍，硬拦就只能让 lyjw 手动合
export async function receiptReason(pr: number, deps: { fetch?: FetchLike; patchId?: PatchId } = {}): Promise<string | null> {
  const fetchImpl = deps.fetch ?? fetch;
  try {
    const gh = client(fetchImpl);
    const [pull, files] = await Promise.all([gh.get<Pull>(`pulls/${pr}`), gh.all<PrFile>(`pulls/${pr}/files`)]);
    const tier = prTier(pull, changedPaths(files));
    if (tier.need === null) return null;
    const result = await checkReceipt({ pr, need: tier.need, wantJudge: tier.judge }, { fetch: fetchImpl, patchId: deps.patchId });
    if (result.pass) return null;
    return `#${pr} 是 ${tier.name} 档，要 Verify Action 签的回执到 ${tier.need}${tier.judge ? "、判定 PASS" : ""}，盖住当前 head：${result.next ?? "还没有"}`;
  } catch (error) {
    return `读不到 #${pr} 的回执（${(error as Error).message}），判不了能不能合：云端确认钩子带着 NODE_USE_ENV_PROXY=1，再合并。`;
  }
}

// Jev 的注释建议不挡 ready，pr-gate 只放在 notes 里，合并时容易被跳过；合并前再提醒一次。读不到也要说。
export async function commentReason(pr: number, deps: { fetch?: FetchLike } = {}): Promise<string | null> {
  try {
    const gh = client(deps.fetch ?? fetch);
    const pull = await gh.get<Pull>(`pulls/${pr}`);
    const [files, runs] = await Promise.all([gh.all<PrFile>(`pulls/${pr}/files`), gh.get<{ check_runs?: CheckRun[] }>(`commits/${pull.head.sha}/check-runs?per_page=100`)]);
    return commentAdvice(runs.check_runs ?? [], changedPaths(files));
  } catch (error) {
    return `读不到 #${pr} head 上的 Comment check (Jev)（${(error as Error).message}）：去 PR 评论里看 Jev 列出的新注释再合并。`;
  }
}

async function main() {
  let input: { tool_input?: MergeInput };
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    process.stderr.write("已拦下：读不懂合并调用的参数。\n");
    process.exit(2);
  }
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const tool = input.tool_input ?? {};
  const reason = mergeMethodReason(tool, (sha) => countCommits(sha, cwd), labelsOf);
  if (reason !== null) {
    process.stderr.write(`已拦下：${reason}\n`);
    process.exit(2);
  }
  if (!isLyjwpage(tool)) return;
  const pr = Number(tool.pullNumber);
  const [receipt, comments] = await Promise.all([receiptReason(pr), commentReason(pr)]);
  const lines = [receipt && `回执提醒（不拦）：${receipt}`, comments && `注释提醒（不拦）：${comments}`].filter(Boolean);
  if (!lines.length) return;
  const notice = lines.join("\n");
  process.stdout.write(
    JSON.stringify({
      systemMessage: notice,
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `${notice}\n合并后在汇报里告诉 lyjw 这些提醒；注释提醒要先逐条判断删还是留，该删的删掉推送后再合。` },
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
