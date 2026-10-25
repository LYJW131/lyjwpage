#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildCoverage } from "./pr-gate/checks.ts";
import { changedPaths, client, isTrustedAuthor, type CheckRun, type Client, type FetchLike, type PrFile, type Pull } from "./pr-gate/github.ts";
import { judgeAsked, tierOf } from "./pr-gate/tier.ts";
import { previewWorkerOrigin, SITE_PREVIEW_WORKER_SCRIPT } from "./preview-worker-name.ts";
import { evaluate, gitPatchId, parseComments, signStamp, type Comment, type Evaluation } from "./verify-receipt.ts";
import { gitNotesOnly, gitRulesChanged } from "./verify-receipt/notes-only.ts";
import { bodyDigest, parseBody } from "./verify-action/body.ts";
import { machineLine, runProof, type ProofSummary } from "./verify-action/machine.ts";
import { judgePrompt, verifierPrompt } from "./verify-action/prompts.ts";
import {
  blockedComment,
  JUDGE_SCHEMA,
  judgeComment,
  judgeVerdict,
  receiptComment,
  reconcile,
  VERIFIER_SCHEMA,
  type JudgeReport,
  type VerifierReport,
} from "./verify-action/report.ts";

export { parseBody } from "./verify-action/body.ts";
export { reconcile, receiptComment, judgeComment, judgeVerdict } from "./verify-action/report.ts";

const HELP = `用法：node scripts/verify-action.ts <子命令> --pr <号> [选项]
给 .github/workflows/verify.yml 用：验证员与判定员在 GitHub Action 里跑，回执与判定由 lyjw131[bot] 发成 PR 评论。
读 GitHub 用 GITHUB_TOKEN；在 Action 外跑时云端要加 NODE_USE_ENV_PROXY=1。输出写进 GITHUB_OUTPUT（没有就打印）。
退出码 0 成功、1 读写 GitHub 出错、2 参数错。

  plan                         分档：need（回执至少的等级，空 = 不用验）、judge、ui、head、branch、base
  proof --base REF [--out-dir DIR]
                               撤回证明：PR 改了 scripts/、src/、shared/、workers/*/ 下的测试又改了别的文件时，跑 revert-proof；
                               结果写进 DIR/work/revert-proof.json，摘要输出成 proof。不读 GitHub、不要令牌
  ci --head SHA [--timeout-min N]
                               等 head 上 CI 的 check 跑完（默认 20 分钟，工作流里给 5），输出它的结论（没跑完是 pending，没有是 none）
  wait-preview [--timeout-min N]  等站点分支预览部署到 head（默认 20 分钟），输出 preview 地址；没就绪输出空
  prompt --role verifier|judge [--preview URL] [--out-dir DIR]
                               输出 prompt 与 schema（结构化结果的 JSON Schema）
  publish --head SHA --run-url URL [--verify-result R] [--judge-result R] [--shots-dir DIR] [--shots-url URL]
                               读环境变量 VERIFY_OUTPUT / JUDGE_OUTPUT（两个 job 的结构化结果）与 CI_OUTPUT / PROOF_OUTPUT（脚本跑的两项），对照清单定回执等级，发回执与判定评论（第二行是 PR 描述的摘要）；
                               head 已不是 PR 当前 head 时什么都不发`;

class UsageError extends Error {}

type FullPull = Pull & { head: { sha: string; ref: string }; body?: string | null; draft?: boolean };

function setOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(`${name}=${value}`);
    return;
  }
  const delimiter = `EOF_${randomBytes(12).toString("hex")}`;
  fs.appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function load(gh: Client, pr: number) {
  const pull = await gh.get<FullPull>(`pulls/${pr}`);
  const files = changedPaths(await gh.all<PrFile>(`pulls/${pr}/files`));
  return { pull, files, tier: tierOf(files, { trustedAuthor: isTrustedAuthor(pull), judgeAsked: judgeAsked(pull) }) };
}

export function planOf(pull: FullPull, tier: ReturnType<typeof tierOf>) {
  const skip = pull.draft === true || pull.state !== "open" || tier.need === null;
  return {
    need: skip ? "" : (tier.need ?? ""),
    judge: !skip && tier.judge,
    ui: !skip && tier.ui.length > 0,
    tier: tier.name,
    head: pull.head.sha,
    branch: pull.head.ref,
    base: pull.base?.ref ?? "main",
  };
}

// 上次通过的回执（与要判定时的判定）还盖得住 head，就不再跑验证员：常见于评审后只改了措辞或注释
// 只给新推送沿用：改目标分支、贴标签这些事件的回执没记目标分支，照常重验
export function carryOver(plan: ReturnType<typeof planOf>, reuse: Evaluation, event: string | undefined) {
  if (event !== "synchronize" || plan.base !== "main" || plan.need === "" || !reuse.pass || !reuse.receipt) return { plan, note: null };
  const from = reuse.receipt.sha.slice(0, 7);
  return { plan: { ...plan, need: "", judge: false, ui: false }, note: `沿用 ${from} 的回执（${reuse.receipt.coverage}）：之后只改了文档或代码注释，这次不跑验证员` };
}

async function plan(gh: Client, pr: number) {
  const { pull, tier } = await load(gh, pr);
  const planned = planOf(pull, tier);
  let reuse: Evaluation | null = null;
  if (planned.need !== "") {
    try {
      reuse = evaluate({
        head: planned.head,
        ...parseComments(await gh.all<Comment>(`issues/${pr}/comments`)),
        need: planned.need,
        wantJudge: planned.judge,
        patchId: gitPatchId,
        notesOnly: gitNotesOnly,
        rulesChanged: gitRulesChanged,
        body: await bodyDigest(pull.body),
      });
    } catch (error) {
      console.log(`查上次回执失败，照常验证：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const { plan: result, note } = reuse ? carryOver(planned, reuse, process.env.EVENT_ACTION) : { plan: planned, note: null };
  if (note) {
    console.log(note);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${note}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  for (const [key, value] of Object.entries(result)) setOutput(key, String(value));
}

const POLL_MS = 20_000;

async function waitPreview(gh: Client, pr: number, timeoutMin: number) {
  const deadline = Date.now() + timeoutMin * 60_000;
  for (;;) {
    const { pull, files } = await load(gh, pr);
    const head = pull.head.sha;
    const [runs, commits] = await Promise.all([
      gh.get<{ check_runs?: CheckRun[] }>(`commits/${head}/check-runs?per_page=100`),
      gh.all<{ sha: string }>(`pulls/${pr}/commits`),
    ]);
    const builds = await buildCoverage({ gh, files, head, headRuns: runs.check_runs ?? [], commits: commits.map((commit) => commit.sha) });
    const origin = previewWorkerOrigin(pull.head.ref, SITE_PREVIEW_WORKER_SCRIPT) ?? "";
    const gap = builds.missing.find((item) => item.worker === "site");
    if (!builds.expected.includes("site")) {
      console.log("这个 PR 不碰站点的预览监视路径，没有站点预览可等");
      setOutput("preview", "");
      return;
    }
    if (!gap) {
      console.log(`站点预览已就绪：${origin}`);
      setOutput("preview", origin);
      return;
    }
    if (gap.reason.startsWith("head 上的构建结论是") || Date.now() > deadline) {
      console.log(`站点预览没就绪：${gap.reason}`);
      setOutput("preview", "");
      return;
    }
    console.log(`等站点预览：${gap.reason}`);
    await sleep(POLL_MS);
  }
}

async function prompt(gh: Client, pr: number, role: string, preview: string, outDir: string) {
  const { pull, files, tier } = await load(gh, pr);
  const { checklist, words } = parseBody(pull.body);
  const common = { pr, title: pull.title, head: pull.head.sha, base: pull.base?.ref ?? "main", files };
  if (role === "verifier") {
    fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
    fs.mkdirSync(path.join(outDir, "work"), { recursive: true });
    const p = planOf(pull, tier);
    const proof = parsed<{ summary?: ProofSummary }>(readIfExists(path.join(outDir, "work", "revert-proof.json")))?.summary ?? { verdict: "error", tests: [] };
    setOutput("prompt", verifierPrompt({ ...common, tier: tier.name, need: p.need, preview: preview || null, checklist, outDir, proof: machineLine({ proof })?.replace(/^脚本：/, "") ?? null }));
    setOutput("schema", JSON.stringify(VERIFIER_SCHEMA));
  } else {
    setOutput("prompt", judgePrompt({ ...common, words, body: pull.body ?? "" }));
    setOutput("schema", JSON.stringify(JUDGE_SCHEMA));
  }
  setOutput("read", readMark(common.base, await bodyDigest(pull.body)));
}

const readMark = (base: string, digest: string) => `${base}@${digest}`;

const readIfExists = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);

// 先写一份 error 占位：这一步被超时杀掉或抛错时，验证员读到的是「没跑成」，不会当成没改测试
function proofStep(base: string, outDir: string) {
  const file = path.join(outDir, "work", "revert-proof.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ summary: { verdict: "error", tests: [] }, proof: null }));
  const { summary, proof } = runProof(process.cwd(), base);
  fs.writeFileSync(file, JSON.stringify({ summary, proof }, null, 2));
  console.log(machineLine({ proof: summary }));
  setOutput("proof", JSON.stringify(summary));
}

async function ciStep(gh: Client, head: string, timeoutMin: number) {
  const deadline = Date.now() + timeoutMin * 60_000;
  for (;;) {
    const runs = (await gh.get<{ check_runs?: CheckRun[] }>(`commits/${head}/check-runs?check_name=check&per_page=100`)).check_runs ?? [];
    const latest = [...runs].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
    const state = latest?.status === "completed" ? (latest.conclusion ?? "none") : latest ? "pending" : "none";
    if ((state !== "pending" && state !== "none") || Date.now() > deadline) {
      console.log(`CI check：${state}`);
      setOutput("ci", state);
      return;
    }
    await sleep(POLL_MS);
  }
}

// 读过之后描述或目标分支又改了，结果对不上现在的 PR，不签，由改动触发的新运行重做；job 成功却没交回读到的版本同样不签。
// job 在读之前就挂了时没有这一项，照常发 blocked
export const staleRead = (read: string | undefined, result: string, current: string) => !(read === current || (!read && result !== "success"));

function parsed<T>(raw: string | undefined): T | null {
  try {
    const value = JSON.parse(raw ?? "") as unknown;
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

const SHOT_NAME = /^[\w.-]+\.png$/;

export function shotLinks(dir: string, baseUrl: string) {
  if (!dir || !baseUrl || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => SHOT_NAME.test(name))
    .sort()
    .map((name) => ({ name, url: `${baseUrl}/${encodeURIComponent(name)}` }));
}

async function publish(
  gh: Client,
  pr: number,
  opts: { head: string; runUrl: string; verifyResult: string; judgeResult: string; shotsDir: string; shotsUrl: string },
) {
  const pull = await gh.get<FullPull>(`pulls/${pr}`);
  if (pull.head.sha !== opts.head) {
    console.log(`PR 的 head 已经是 ${pull.head.sha}，这次按 ${opts.head} 的结果不发`);
    return;
  }
  const { checklist } = parseBody(pull.body);
  const digest = await bodyDigest(pull.body);
  const stamp = (parts: { level?: string; verdict?: string }) => ({ ...signStamp({ ref: opts.head, ...parts }), body: digest });
  const comments: string[] = [];
  const current = readMark(pull.base?.ref ?? "main", digest);
  const readOld = (read: string | undefined, result: string, role: string) => {
    if (!staleRead(read, result, current)) return false;
    console.log(`${role}读的${read ? "是改之前的 PR 描述或目标分支" : "版本没交回来"}，这次不发`);
    return true;
  };
  if (opts.verifyResult && opts.verifyResult !== "skipped" && !readOld(process.env.VERIFY_READ, opts.verifyResult, "验证员")) {
    const report = opts.verifyResult === "success" ? parsed<VerifierReport>(process.env.VERIFY_OUTPUT) : null;
    if (report && Array.isArray(report.rows)) {
      const shots = shotLinks(opts.shotsDir, opts.shotsUrl);
      const { level, claimed, problems } = reconcile(checklist, { ...report, notVerified: report.notVerified ?? [] }, { shots: shots.length });
      const machine = machineLine({ ci: process.env.CI_OUTPUT, proof: parsed<ProofSummary>(process.env.PROOF_OUTPUT) });
      comments.push(receiptComment({ stamp: stamp({ level }), report, checklist, problems, claimed, shots, machine, runUrl: opts.runUrl }));
    } else {
      const reason = opts.verifyResult === "success" ? "验证员没交回结构化结果" : `验证 job 的结论是 ${opts.verifyResult}`;
      comments.push(blockedComment({ stamp: stamp({ level: "verifier-blocked" }), reason, runUrl: opts.runUrl }));
    }
  }
  if (opts.judgeResult && opts.judgeResult !== "skipped" && !readOld(process.env.JUDGE_READ, opts.judgeResult, "判定员")) {
    const report = opts.judgeResult === "success" ? parsed<JudgeReport>(process.env.JUDGE_OUTPUT) : null;
    if (report && (report.verdict === "PASS" || report.verdict === "FAIL")) {
      const full = { ...report, asks: report.asks ?? [], regressions: report.regressions ?? [], fixes: report.fixes ?? [] };
      comments.push(judgeComment({ stamp: stamp({ verdict: judgeVerdict(full) }), report: full, runUrl: opts.runUrl }));
    } else {
      comments.push(`判定员没跑成（判定 job 的结论是 ${opts.judgeResult}），这个 head 没有判定。[Action 运行](${opts.runUrl})`);
    }
  }
  for (const body of comments) {
    await gh.post(`issues/${pr}/comments`, { body });
    console.log(body.split("\n", 1)[0]);
  }
}

const OPTIONS = {
  pr: { type: "string" },
  role: { type: "string", default: "verifier" },
  preview: { type: "string", default: "" },
  "out-dir": { type: "string", default: "" },
  "timeout-min": { type: "string", default: "20" },
  head: { type: "string", default: "" },
  "run-url": { type: "string", default: "" },
  "verify-result": { type: "string", default: "" },
  "judge-result": { type: "string", default: "" },
  "shots-dir": { type: "string", default: "" },
  "shots-url": { type: "string", default: "" },
  base: { type: "string", default: "" },
  help: { type: "boolean", default: false },
} as const;

const COMMAND_OPTIONS: Record<string, string[]> = {
  plan: ["pr"],
  "wait-preview": ["pr", "timeout-min"],
  prompt: ["pr", "role", "preview", "out-dir"],
  proof: ["pr", "base", "out-dir"],
  ci: ["pr", "head", "timeout-min"],
  publish: ["pr", "head", "run-url", "verify-result", "judge-result", "shots-dir", "shots-url"],
};

export async function main(argv: string[], fetchImpl: FetchLike = fetch) {
  const [command, ...args] = argv;
  let values, tokens;
  try {
    ({ values, tokens } = parseArgs({ args, strict: true, options: OPTIONS, tokens: true }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (values.help || command === "--help" || !command) {
    console.log(HELP);
    return 0;
  }
  const allowed = COMMAND_OPTIONS[command];
  if (!allowed) throw new UsageError(`不认识的子命令 ${command}`);
  const stray = tokens.find((token) => token.kind === "option" && !allowed.includes(token.name));
  if (stray?.kind === "option") throw new UsageError(`${command} 不收 --${stray.name}`);
  const pr = Number(values.pr);
  if (!Number.isInteger(pr) || pr <= 0) throw new UsageError("缺 --pr");
  const timeoutMin = Number(values["timeout-min"]);
  if (!(timeoutMin > 0)) throw new UsageError("--timeout-min 要正数");
  const gh = client(fetchImpl);
  const outDir = values["out-dir"] || path.join(process.env.RUNNER_TEMP ?? "/tmp", "verify-out");
  if (command === "plan") await plan(gh, pr);
  else if (command === "proof") {
    if (!values.base) throw new UsageError("缺 --base");
    proofStep(values.base, outDir);
  } else if (command === "ci") {
    if (!/^[0-9a-f]{40}$/.test(values.head)) throw new UsageError("--head 要完整 40 位 SHA");
    await ciStep(gh, values.head, timeoutMin);
  }
  else if (command === "wait-preview") await waitPreview(gh, pr, timeoutMin);
  else if (command === "prompt") {
    if (!["verifier", "judge"].includes(values.role)) throw new UsageError("--role 只收 verifier、judge");
    await prompt(gh, pr, values.role, values.preview, outDir);
  } else if (command === "publish") {
    if (!/^[0-9a-f]{40}$/.test(values.head)) throw new UsageError("--head 要完整 40 位 SHA");
    await publish(gh, pr, {
      head: values.head,
      runUrl: values["run-url"],
      verifyResult: values["verify-result"],
      judgeResult: values["judge-result"],
      shotsDir: values["shots-dir"],
      shotsUrl: values["shots-url"],
    });
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    const usage = error instanceof UsageError;
    console.error(usage ? `${error.message}\n${HELP}` : (error as Error).message);
    process.exitCode = usage ? 2 : 1;
  }
}
