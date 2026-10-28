import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SYSTEM_DENY_READ, rateLimitReset, reviewerConfig, runDevin, userOtel } from "./lib/devin.js";
import { parseFindings } from "./lib/findings.js";
import { REPO_DIR, git, gitSource } from "./lib/git-source.js";
import { triggerMessage } from "./lib/prompt.js";
import { type PullTarget, reviewWorkspace } from "./lib/workspace.js";

const { values } = parseArgs({
  options: {
    repo: { type: "string", default: REPO_DIR },
    base: { type: "string", default: "origin/main" },
    head: { type: "string", default: "HEAD" },
    title: { type: "string" },
    intent: { type: "string" },
    pr: { type: "string" },
    out: { type: "string" },
  },
});
const RUN_TIMEOUT_MS = 40 * 60_000;
const MAX_RATE_WAIT_MS = 30 * 60_000;
// 快照放在 /var/tmp：/tmp 下有会话的草稿与评测结果，整个不许评审员读。
const WORKSPACE_ROOT = "/var/tmp/pr-review-run";

const repoDir = resolve(values.repo!);
const headSha = (await git(["rev-parse", `${values.head}^{commit}`], repoDir)).trim();
const baseSha = (await git(["merge-base", values.base!, headSha], repoDir)).trim();
if ((await git(["status", "--porcelain", "--untracked-files=no"], repoDir)).trim()) {
  console.warn("warning: uncommitted changes are not reviewed; only the committed head is");
}
const commits = (await git(["log", "--reverse", "--format=%s%n%n%b", `${baseSha}..${headSha}`], repoDir)).trim();
if (!commits) throw new Error(`no commits between ${values.base} and ${values.head}`);
const origin = (await git(["remote", "get-url", "origin"], repoDir).catch(() => "")).trim();
const [owner, repo] = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(origin)?.slice(1) ?? ["LYJW131", "lyjwpage"];
const intent = values.intent ? await readFile(values.intent, "utf8") : "";
const target: PullTarget = {
  owner,
  repo,
  number: values.pr ? Number(values.pr) : undefined,
  title: values.title ?? (await git(["log", "-1", "--format=%s", headSha], repoDir)).trim(),
  body: [intent.trim(), `## Commits\n\n${commits}`].filter(Boolean).join("\n\n"),
  author: (await git(["log", "-1", "--format=%an", headSha], repoDir)).trim(),
  baseSha,
  headSha,
};

await mkdir(WORKSPACE_ROOT, { recursive: true });
const workspace = await mkdtemp(join(WORKSPACE_ROOT, `${headSha.slice(0, 12)}-`));
const out = values.out ? resolve(values.out) : await mkdtemp(join(tmpdir(), "pr-review-"));
await mkdir(out, { recursive: true });
const files = await reviewWorkspace(gitSource(target, repoDir), target);
for (const [path, content] of Object.entries(files)) {
  await mkdir(dirname(join(workspace, path)), { recursive: true });
  await writeFile(join(workspace, path), content);
}
const configPath = join(out, "config.json");
const promptPath = join(out, "prompt.md");
const exportPath = join(out, "export.json");
// 评测用例的快照（`evals/cases.ts#WORKSPACES` 的默认位置）带标注里的旧 PR，也不许读。
const deny = [...SYSTEM_DENY_READ, "/tmp/**", "/var/tmp/pr-review-ws/**"];
await writeFile(configPath, JSON.stringify(reviewerConfig(deny, userOtel()), null, 1));
const prompt = await readFile(new URL("./review.txt", import.meta.url), "utf8");
await writeFile(promptPath, `${prompt}\n\n---\n\n${triggerMessage(target)}\n`);

// 免费档限流只等一次、最多 30 分钟；再撞就记失败退出。
async function runReviewer(): Promise<{ stdout: string; ms: number }> {
  for (let attempt = 0; ; attempt++) {
    const run = await runDevin({ cwd: workspace, promptFile: promptPath, configPath, exportPath, timeoutMs: RUN_TIMEOUT_MS });
    const reset = rateLimitReset(`${run.stdout}\n${run.stderr}`);
    if (reset && attempt === 0 && reset.getTime() - Date.now() < MAX_RATE_WAIT_MS) {
      console.log(`rate limited until ${reset.toISOString()}`);
      await new Promise((r) => setTimeout(r, Math.max(reset.getTime() - Date.now() + 30_000, 30_000)));
      continue;
    }
    if (run.code !== 0) {
      throw new Error(`devin exited ${run.code} after ${Math.round(run.ms / 1000)}s: ${(run.stderr || run.stdout).slice(-1500)}`);
    }
    return run;
  }
}

try {
  const run = await runReviewer();
  await writeFile(join(out, "reply.txt"), run.stdout);
  const findings = parseFindings(run.stdout);
  await writeFile(join(out, "findings.json"), JSON.stringify({ base: baseSha, head: headSha, findings }, null, 1));
  console.log(`${findings.length} finding(s) on ${headSha.slice(0, 12)} (base ${baseSha.slice(0, 12)}), ${Math.round(run.ms / 1000)}s; full output in ${out}`);
  findings.forEach((item, i) => {
    console.log(`\nF${i + 1} [${item.severity} ${item.kind}] ${item.file}:${item.line} ${item.title}\n${item.detail}`);
  });
} finally {
  await rm(workspace, { recursive: true, force: true });
}
