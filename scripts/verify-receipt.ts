#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { bodyDigest } from "./verify-action/body.ts";
import { gitNotesOnly, type NotesOnly } from "./verify-receipt/notes-only.ts";

const REPO = "LYJW131/lyjwpage";
// lyjw 的两个账号（LYJW131、云端会话用的 An0nCh1hayaa），按数字 id 认而不按 login：login 改名后可被别人注册。
export const TRUSTED_AUTHOR_IDS = new Set([153256373, 300701323]);
// 回执和判定只认 lyjw131[bot]（GitHub App 的机器人账号）：由 .github/workflows/verify.yml 的 publish job 拿 App 令牌发；
// github-actions[bot] 任何工作流都能冒充，线程用 lyjw 的账号发的同格式评论也不算。
// verify、judge job 带着 Claude 的令牌从 PR 检出跑这个文件，只能 import scripts/ 下的，所以 ID 写死（同 docs/ops-facts.md 的 lyjw131[bot] 用户 ID）
export const RECEIPT_SIGNER_IDS = new Set([338272049]);
const REQUEST_TIMEOUT_MS = 30_000;

export const LEVELS = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"];
export const PASSING_RANK: Record<string, number> = { "live-ui-verified": 3, "unit-test-verified": 2, "type-check-only": 1 };

const VERDICTS = ["PASS", "FAIL"];

// 契约：回执与判定评论里机器只读第二行的这行 JSON（body 是 PR 描述摘要，见 verify-action/body.ts#bodyDigest）；第一行的中文只给人看。
// 只认第二行：同一个 lyjw131[bot] 发的评论正文里会带验证员证据、Jev 意见这类 PR 能左右的文字，别处的戳行一律不算
const STAMP_LINE = /^<!-- verify-stamp (\{.*\}) -->$/;
export type Stamp = { sha: string; level?: string; verdict?: string; body: string };
export const stampLine = (stamp: Stamp) => `<!-- verify-stamp ${JSON.stringify(stamp)} -->`;
export const stampTitle = ({ sha, level, verdict }: Omit<Stamp, "body">) => (level !== undefined ? `验证回执 ${sha}：${level}` : `判定 ${sha}：${verdict}`);

function readStamp(text: string): Stamp | null {
  const match = STAMP_LINE.exec(text.split("\n")[1] ?? "");
  if (!match) return null;
  let stamp: Partial<Stamp>;
  try {
    stamp = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof stamp.sha !== "string" || !/^[0-9a-f]{40}$/.test(stamp.sha)) return null;
  if (typeof stamp.body !== "string" || !/^[0-9a-f]{64}$/.test(stamp.body)) return null;
  const level = typeof stamp.level === "string" && LEVELS.includes(stamp.level) ? stamp.level : undefined;
  const verdict = typeof stamp.verdict === "string" && VERDICTS.includes(stamp.verdict) ? stamp.verdict : undefined;
  if ((level === undefined) === (verdict === undefined)) return null;
  return { sha: stamp.sha, body: stamp.body, ...(level !== undefined ? { level } : { verdict }) };
}

const HELP = `用法：
  NODE_USE_ENV_PROXY=1 node scripts/verify-receipt.ts check --pr <号> [选项]
  node scripts/verify-receipt.ts sign --sha <提交> (--level <等级> | --verdict PASS|FAIL)

sign 打印回执或判定给人看的第一行：SHA 由 git rev-parse 展开成完整 40 位，等级只收五档之一。
Verify Action 的 publish job 用同一套校验拼评论，check 只读评论里的 verify-stamp JSON 行，不读这行中文。退出码 0 成功、2 参数错或提交不存在。

check 查 PR 评论里 lyjw131[bot] 发的最新「验证回执」与「判定」还盖不盖得住当前 head。
输出 JSON，pass 为假时 next 写下一步；退出码 0 通过、1 不通过、2 参数错。

check 的选项：
  --pr <号>        PR 号（必填）
  --need <等级>    回执至少要到的等级，默认 unit-test-verified；改了行为的不收 type-check-only
                   等级从高到低：live-ui-verified、unit-test-verified、type-check-only
  --judge          还要一条 PASS 的「判定」盖住 head（lyjwpage-verify「3b」那类 PR）
  --help           显示本说明

回执或判定按的提交不是当前 head 时，比两边相对 main 的补丁（逐字节，含空白与二进制，只忽略行号）：
相同就沿用（coverage=carried，常见于只把 main 合进分支）；补丁不同，但那个提交到 head 只改了文档（规则文档除外）或代码注释，
也沿用（coverage=notes-only，见 verify-receipt/notes-only.ts）；其余作废（coverage=stale）。
比补丁要用本地 git：先 git fetch origin main。`;

export type Comment = { user?: { id?: number } | null; body?: string | null; html_url?: string | null };
type Receipt = { sha: string; level: string; body?: string | null; url?: string | null };
type Judge = { sha: string; verdict: string; body?: string | null; url?: string | null };
type Coverage = "exact" | "carried" | "notes-only" | "stale";
type PatchId = (sha: string) => string | null;

export type Evaluation = {
  head: string;
  receipt: (Receipt & { coverage: Coverage }) | null;
  judge: (Judge & { coverage: Coverage }) | null;
  pass: boolean;
  next: string | null;
};

export function signStamp(
  { ref, level, verdict }: { ref: string; level?: string; verdict?: string },
  revParse: (ref: string) => string = gitRevParse,
): Omit<Stamp, "body"> {
  if ((level === undefined) === (verdict === undefined)) throw new Error("--level 与 --verdict 二选一");
  if (level !== undefined && !LEVELS.includes(level)) throw new Error(`等级只收 ${LEVELS.join("、")}`);
  if (verdict !== undefined && !VERDICTS.includes(verdict)) throw new Error("判定只收 PASS、FAIL");
  const sha = revParse(ref);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${ref} 展开不成完整 SHA`);
  return level !== undefined ? { sha, level } : { sha, verdict };
}

function gitRevParse(ref: string) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`本地找不到提交 ${ref}：先 git fetch`);
  }
}

export function parseComments(comments: Comment[]) {
  let receipt: Receipt | null = null;
  let judge: Judge | null = null;
  for (const comment of comments) {
    if (!RECEIPT_SIGNER_IDS.has(comment.user?.id ?? 0)) continue;
    const stamp = readStamp(comment.body ?? "");
    if (!stamp) continue;
    const url = comment.html_url ?? null;
    if (stamp.level !== undefined) receipt = { sha: stamp.sha, level: stamp.level, body: stamp.body, url };
    else if (stamp.verdict !== undefined) judge = { sha: stamp.sha, verdict: stamp.verdict, body: stamp.body, url };
  }
  return { receipt, judge };
}

export function patchDigest(diff: string) {
  if (!diff) return null;
  const normalized = diff.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm, "@@");
  return createHash("sha256").update(normalized).digest("hex");
}

export function coverage(sha: string, head: string, patchId: PatchId, notesOnly?: NotesOnly): Coverage {
  if (sha === head) return "exact";
  try {
    const before = patchId(sha);
    if (before && before === patchId(head)) return "carried";
    return notesOnly?.(sha, head) ? "notes-only" : "stale";
  } catch {
    return "stale";
  }
}

export function evaluate({
  head,
  receipt,
  judge,
  need,
  wantJudge,
  patchId,
  notesOnly,
  body,
}: {
  head: string;
  receipt: Receipt | null;
  judge: Judge | null;
  need: string;
  wantJudge: boolean;
  patchId: PatchId;
  notesOnly?: NotesOnly;
  body?: string;
}): Evaluation {
  const result: Evaluation = { head, receipt: null, judge: null, pass: false, next: null };
  const problems: string[] = [];

  if (!receipt) {
    problems.push("没有验证回执：等 Verify Action 跑完（PR 转为待审或推送时触发），没跑就重跑这个 PR 上 Verify 的那次运行（gh run rerun）");
  } else {
    const receiptCoverage = coverage(receipt.sha, head, patchId, notesOnly);
    result.receipt = { ...receipt, coverage: receiptCoverage };
    const rank = PASSING_RANK[receipt.level] ?? 0;
    if (rank === 0) problems.push(`回执等级是 ${receipt.level}：不是通过，修好后推送，或环境恢复后重跑 Verify Action`);
    else if (rank < PASSING_RANK[need]) problems.push(`回执等级 ${receipt.level} 低于要求的 ${need}：在 PR 描述的验证清单里补上能验到 ${need} 的项，重跑 Verify Action`);
    if (receiptCoverage === "stale") problems.push(`回执按的 ${receipt.sha.slice(0, 7)} 和当前 head 的补丁不同：等 Verify Action 按新 head 跑完`);
    if (body !== undefined && receipt.body !== body) problems.push("回执之后 PR 描述的验证清单或 lyjw 原话改过（或回执没带描述摘要）：等 Verify Action 按新描述跑完");
  }

  if (wantJudge) {
    if (!judge) {
      problems.push("没有判定：等 Verify Action 的判定 job 跑完");
    } else {
      const judgeCoverage = coverage(judge.sha, head, patchId, notesOnly);
      result.judge = { ...judge, coverage: judgeCoverage };
      if (judge.verdict !== "PASS") problems.push("判定是 FAIL：修完判定员列的项再推送，Action 会重判");
      if (judgeCoverage === "stale") problems.push(`判定按的 ${judge.sha.slice(0, 7)} 和当前 head 的补丁不同：等 Verify Action 按新 head 重判`);
      if (body !== undefined && judge.body !== body) problems.push("判定之后 PR 描述的验证清单或 lyjw 原话改过（或判定没带描述摘要）：等 Verify Action 按新描述重判");
    }
  } else if (judge?.verdict === "FAIL" && coverage(judge.sha, head, patchId, notesOnly) !== "stale") {
    result.judge = { ...judge, coverage: coverage(judge.sha, head, patchId, notesOnly) };
    problems.push("没要求判定，但当前 head 上的判定是 FAIL：修完判定员列的项再推送");
  }

  result.pass = problems.length === 0;
  result.next = result.pass ? null : problems.join("；");
  return result;
}

function ensureCommit(sha: string) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
  } catch {
    execFileSync("git", ["fetch", "-q", "origin", sha], { stdio: "ignore" });
  }
}

// 不用 git patch-id：它忽略空白，也分不清同一路径的不同二进制内容，这两种改动都可能改变用户看到的东西。
export function gitPatchId(sha: string) {
  ensureCommit(sha);
  const base = execFileSync("git", ["merge-base", "origin/main", sha], { encoding: "utf8" }).trim();
  const diff = execFileSync("git", ["diff", "--binary", "--full-index", base, sha], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return patchDigest(diff);
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
}>;

async function github(path: string, fetchImpl: FetchLike): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

export async function check(
  { pr, need, wantJudge }: { pr: number; need: string; wantJudge: boolean },
  deps: { fetch?: FetchLike; patchId?: PatchId; notesOnly?: NotesOnly } = {},
) {
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const patchId = deps.patchId ?? gitPatchId;
  // 测试只注入 patchId 时也别真去跑 git
  const notesOnly = deps.notesOnly ?? (deps.patchId ? undefined : gitNotesOnly);
  const pull = (await github(`pulls/${pr}`, fetchImpl)) as { head: { sha: string }; body?: string | null };
  const head = pull.head.sha;
  const comments: Comment[] = [];
  for (let page = 1; ; page += 1) {
    const batch = (await github(`issues/${pr}/comments?per_page=100&page=${page}`, fetchImpl)) as Comment[];
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return { pr, ...evaluate({ head, ...parseComments(comments), need, wantJudge, patchId, notesOnly, body: await bodyDigest(pull.body) }) };
}

const USAGE = "用法：check --pr <号> [--need 等级] [--judge]，或 sign --sha <提交> (--level 等级 | --verdict PASS|FAIL)；见 --help";

const SIGN_OPTIONS = { sha: { type: "string" }, level: { type: "string" }, verdict: { type: "string" } } as const;
const CHECK_OPTIONS = {
  pr: { type: "string" },
  need: { type: "string", default: "unit-test-verified" },
  judge: { type: "boolean", default: false },
} as const;

function sign(args: string[]) {
  try {
    const { values } = parseArgs({ args, strict: true, options: SIGN_OPTIONS });
    if (values.sha === undefined) throw new Error("缺 --sha");
    console.log(stampTitle(signStamp({ ref: values.sha, level: values.level, verdict: values.verdict })));
    return 0;
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
}

async function main(argv: string[]) {
  if (argv.includes("--help")) {
    console.log(HELP);
    return 0;
  }
  const [command, ...args] = argv;
  if (command === "sign") return sign(args);
  let values;
  try {
    ({ values } = parseArgs({ args, strict: true, options: CHECK_OPTIONS }));
  } catch {
    values = null;
  }
  const pr = Number(values?.pr);
  if (command !== "check" || !values || !Number.isInteger(pr) || pr <= 0 || !Object.hasOwn(PASSING_RANK, values.need)) {
    console.log(JSON.stringify({ pass: false, next: USAGE }));
    return 2;
  }
  try {
    const result = await check({ pr, need: values.need, wantJudge: values.judge });
    console.log(JSON.stringify(result, null, 2));
    return result.pass ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ pr, pass: false, next: `读不到 PR 或评论（${(error as Error).message}）；云端要加 NODE_USE_ENV_PROXY=1` }));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
