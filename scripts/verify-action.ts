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
import { signStamp } from "./verify-receipt.ts";
import { bodyDigest, parseBody } from "./verify-action/body.ts";
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
给 .github/workflows/verify.yml 用：验证员与判定员在 GitHub Action 里跑，回执与判定由 github-actions[bot] 发成 PR 评论。
读 GitHub 用 GITHUB_TOKEN；在 Action 外跑时云端要加 NODE_USE_ENV_PROXY=1。输出写进 GITHUB_OUTPUT（没有就打印）。
退出码 0 成功、1 读写 GitHub 出错、2 参数错。

  plan                         分档：need（回执至少的等级，空 = 不用验）、judge、ui、head、branch
  wait-preview [--timeout-min N]  等站点分支预览部署到 head（默认 20 分钟），输出 preview 地址；没就绪输出空
  prompt --role verifier|judge [--preview URL] [--out-dir DIR]
                               输出 prompt 与 schema（结构化结果的 JSON Schema）
  publish --head SHA --run-url URL [--verify-result R] [--judge-result R] [--shots-dir DIR] [--shots-url URL]
                               读环境变量 VERIFY_OUTPUT / JUDGE_OUTPUT（两个 job 的结构化结果），对照清单定回执等级，发回执与判定评论（第二行是 PR 描述的摘要）；
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
  };
}

async function plan(gh: Client, pr: number) {
  const { pull, tier } = await load(gh, pr);
  const result = planOf(pull, tier);
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
    setOutput("prompt", verifierPrompt({ ...common, tier: tier.name, need: p.need, preview: preview || null, checklist, outDir }));
    setOutput("schema", JSON.stringify(VERIFIER_SCHEMA));
  } else {
    setOutput("prompt", judgePrompt({ ...common, words, body: pull.body ?? "" }));
    setOutput("schema", JSON.stringify(JUDGE_SCHEMA));
  }
}

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
  if (opts.verifyResult && opts.verifyResult !== "skipped") {
    const report = opts.verifyResult === "success" ? parsed<VerifierReport>(process.env.VERIFY_OUTPUT) : null;
    if (report && Array.isArray(report.rows)) {
      const shots = shotLinks(opts.shotsDir, opts.shotsUrl);
      const { level, claimed, problems } = reconcile(checklist, { ...report, notVerified: report.notVerified ?? [] }, { shots: shots.length });
      comments.push(receiptComment({ stamp: stamp({ level }), report, checklist, problems, claimed, shots, runUrl: opts.runUrl }));
    } else {
      const reason = opts.verifyResult === "success" ? "验证员没交回结构化结果" : `验证 job 的结论是 ${opts.verifyResult}`;
      comments.push(blockedComment({ stamp: stamp({ level: "verifier-blocked" }), reason, runUrl: opts.runUrl }));
    }
  }
  if (opts.judgeResult && opts.judgeResult !== "skipped") {
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
  help: { type: "boolean", default: false },
} as const;

export async function main(argv: string[], fetchImpl: FetchLike = fetch) {
  const [command, ...args] = argv;
  let values;
  try {
    ({ values } = parseArgs({ args, strict: true, options: OPTIONS }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (values.help || command === "--help" || !command) {
    console.log(HELP);
    return 0;
  }
  const pr = Number(values.pr);
  if (!Number.isInteger(pr) || pr <= 0) throw new UsageError("缺 --pr");
  const gh = client(fetchImpl);
  if (command === "plan") await plan(gh, pr);
  else if (command === "wait-preview") await waitPreview(gh, pr, Number(values["timeout-min"]) || 20);
  else if (command === "prompt") {
    if (!["verifier", "judge"].includes(values.role)) throw new UsageError("--role 只收 verifier、judge");
    await prompt(gh, pr, values.role, values.preview, values["out-dir"] || path.join(process.env.RUNNER_TEMP ?? "/tmp", "verify-out"));
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
  } else throw new UsageError(`不认识的子命令 ${command}`);
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
