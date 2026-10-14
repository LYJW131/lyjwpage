#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const REPO = "LYJW131/lyjwpage";
// 回执和判定都由主线程用 lyjw 的账号发；别人发的同格式评论不算。
const TRUSTED_AUTHOR = "LYJW131";
const REQUEST_TIMEOUT_MS = 30_000;

export const LEVELS = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"];
const PASSING_RANK = { "live-ui-verified": 3, "unit-test-verified": 2, "type-check-only": 1 };

const RECEIPT_LINE = new RegExp(`^验证回执 ([0-9a-f]{40})[：:]\\s*(${LEVELS.join("|")})\\s*$`);
const JUDGE_LINE = /^判定 ([0-9a-f]{40})[：:]\s*(PASS|FAIL)\s*$/;

const HELP = `用法：NODE_USE_ENV_PROXY=1 node scripts/verify-receipt.mjs check --pr <号> [选项]

查 PR 评论里最新的「验证回执」与「判定」还盖不盖得住当前 head，主线程据此决定要不要再验。
输出 JSON，pass 为假时 next 写下一步；退出码 0 通过、1 不通过、2 参数错。

选项：
  --pr <号>        PR 号（必填）
  --need <等级>    回执至少要到的等级，默认 unit-test-verified；改了行为的不收 type-check-only
                   等级从高到低：live-ui-verified、unit-test-verified、type-check-only
  --judge          还要一条 PASS 的「判定」盖住 head（lyjwpage-verify「3b」那类 PR）
  --help           显示本说明

回执或判定按的提交不是当前 head 时，比两边相对 main 的补丁（逐字节，含空白与二进制，只忽略行号）：
相同就沿用（coverage=carried，常见于只把 main 合进分支），不同就作废（coverage=stale）。
比补丁要用本地 git：先 git fetch origin main。`;

export function parseComments(comments) {
  let receipt = null;
  let judge = null;
  for (const comment of comments) {
    if (comment.user?.login !== TRUSTED_AUTHOR) continue;
    const first = (comment.body ?? "").split("\n", 1)[0].trim();
    const r = RECEIPT_LINE.exec(first);
    if (r) receipt = { sha: r[1], level: r[2], url: comment.html_url ?? null };
    const j = JUDGE_LINE.exec(first);
    if (j) judge = { sha: j[1], verdict: j[2], url: comment.html_url ?? null };
  }
  return { receipt, judge };
}

export function patchDigest(diff) {
  if (!diff) return null;
  const normalized = diff.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm, "@@");
  return createHash("sha256").update(normalized).digest("hex");
}

export function coverage(sha, head, patchId) {
  if (sha === head) return "exact";
  try {
    const before = patchId(sha);
    return before && before === patchId(head) ? "carried" : "stale";
  } catch {
    return "stale";
  }
}

export function evaluate({ head, receipt, judge, need, wantJudge, patchId }) {
  const result = { head, receipt: null, judge: null, pass: false, next: null };
  const problems = [];

  if (!receipt) {
    problems.push("没有验证回执：派验证员，回执第一行照 lyjwpage-verify「回执」的格式发成 PR 评论");
  } else {
    result.receipt = { ...receipt, coverage: coverage(receipt.sha, head, patchId) };
    const rank = PASSING_RANK[receipt.level] ?? 0;
    if (rank === 0) problems.push(`回执等级是 ${receipt.level}：不是通过，修好或环境恢复后重派验证员`);
    else if (rank < PASSING_RANK[need]) problems.push(`回执等级 ${receipt.level} 低于要求的 ${need}：让验证员补验到 ${need}`);
    if (result.receipt.coverage === "stale") problems.push(`回执按的 ${receipt.sha.slice(0, 7)} 和当前 head 的补丁不同：按新 head 重派验证员`);
  }

  if (wantJudge) {
    if (!judge) {
      problems.push("没有判定：按 lyjwpage-verify「3b」派判定员");
    } else {
      result.judge = { ...judge, coverage: coverage(judge.sha, head, patchId) };
      if (judge.verdict !== "PASS") problems.push("判定是 FAIL：修完判定员列的项再判");
      if (result.judge.coverage === "stale") problems.push(`判定按的 ${judge.sha.slice(0, 7)} 和当前 head 的补丁不同：按新 head 重判`);
    }
  }

  result.pass = problems.length === 0;
  result.next = result.pass ? null : problems.join("；");
  return result;
}

function ensureCommit(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
  } catch {
    execFileSync("git", ["fetch", "-q", "origin", sha], { stdio: "ignore" });
  }
}

// 不用 git patch-id：它忽略空白，也分不清同一路径的不同二进制内容，这两种改动都可能改变用户看到的东西。
export function gitPatchId(sha) {
  ensureCommit(sha);
  const base = execFileSync("git", ["merge-base", "origin/main", sha], { encoding: "utf8" }).trim();
  const diff = execFileSync("git", ["diff", "--binary", "--full-index", base, sha], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return patchDigest(diff);
}

async function github(path, fetchImpl) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

export async function check({ pr, need, wantJudge }, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const patchId = deps.patchId ?? gitPatchId;
  const head = (await github(`pulls/${pr}`, fetchImpl)).head.sha;
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(`issues/${pr}/comments?per_page=100&page=${page}`, fetchImpl);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return { pr, ...evaluate({ head, ...parseComments(comments), need, wantJudge, patchId }) };
}

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) flags._.push(arg);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  const pr = Number(flags.pr);
  const need = flags.need ?? "unit-test-verified";
  const judge = flags.judge ?? false;
  if (
    flags._[0] !== "check" ||
    !Number.isInteger(pr) ||
    pr <= 0 ||
    !Object.hasOwn(PASSING_RANK, need) ||
    ![true, false, "true", "false"].includes(judge)
  ) {
    console.log(JSON.stringify({ pass: false, next: "用法：check --pr <号> [--need 等级] [--judge]；见 --help" }));
    return 2;
  }
  try {
    const result = await check({ pr, need, wantJudge: judge === true || judge === "true" });
    console.log(JSON.stringify(result, null, 2));
    return result.pass ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ pr, pass: false, next: `读不到 PR 或评论（${error.message}）；云端要加 NODE_USE_ENV_PROXY=1` }));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
