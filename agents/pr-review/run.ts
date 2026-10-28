import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Octokit } from "@octokit/rest";
import { SYSTEM_DENY_READ, rateLimitReset, reviewerConfig, runDevin } from "./lib/devin.js";
import { parseFindings } from "./lib/findings.js";
import { triggerMessage } from "./lib/prompt.js";
import { commentableLines, reviewPayload } from "./lib/review-body.js";
import { type PullTarget, githubSource, reviewWorkspace } from "./lib/workspace.js";

const RUN_TIMEOUT_MS = 40 * 60_000;
const { GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, RUNNER_TEMP, DRY_RUN } = process.env;
if ((!GITHUB_TOKEN && !DRY_RUN) || !GITHUB_REPOSITORY || !PR_NUMBER) {
  throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required");
}
const [owner, repo] = GITHUB_REPOSITORY.split("/");
// 每个 GitHub 请求各自限时；tarball 有十几 MB，给足两分钟。
const octokit = new Octokit({
  auth: GITHUB_TOKEN,
  request: { fetch: (url: string, init: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(120_000) }) },
});

const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: Number(PR_NUMBER) });
if (pr.draft) {
  console.log("draft PR, skipped");
  process.exit(0);
}
const target: PullTarget = {
  owner,
  repo,
  number: pr.number,
  title: pr.title,
  body: pr.body ?? "",
  author: pr.user?.login ?? "unknown",
  baseSha: pr.base.sha,
  headSha: pr.head.sha,
};

// 工作区放在 /tmp，提示词与配置放在 RUNNER_TEMP（家目录下，评审员读不到）。
const workspace = await mkdtemp(join(tmpdir(), "pr-review-"));
const files = await reviewWorkspace(githubSource(octokit, target), target);
for (const [path, content] of Object.entries(files)) {
  await mkdir(dirname(join(workspace, path)), { recursive: true });
  await writeFile(join(workspace, path), content);
}
const scratch = await mkdtemp(join(RUNNER_TEMP ?? tmpdir(), "pr-review-cfg-"));
const configPath = join(scratch, "config.json");
const promptPath = join(scratch, "prompt.md");
const exportPath = join(scratch, "export.json");
await writeFile(configPath, JSON.stringify(reviewerConfig(SYSTEM_DENY_READ), null, 1));
const prompt = await readFile(new URL("./review.txt", import.meta.url), "utf8");
await writeFile(promptPath, `${prompt}\n\n---\n\n${triggerMessage(target)}\n`);

// 免费档限流只等一次、最多 30 分钟；再撞就让这次运行失败，日志里看得到。
async function runReviewer(): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const run = await runDevin({ cwd: workspace, promptFile: promptPath, configPath, exportPath, timeoutMs: RUN_TIMEOUT_MS, bin: process.env.DEVIN_BIN });
    const reset = rateLimitReset(`${run.stdout}\n${run.stderr}`);
    if (reset && attempt === 0 && reset.getTime() - Date.now() < 30 * 60_000) {
      console.log(`rate limited until ${reset.toISOString()}`);
      await new Promise((r) => setTimeout(r, Math.max(reset.getTime() - Date.now() + 30_000, 30_000)));
      continue;
    }
    if (run.code !== 0) {
      throw new Error(`devin exited ${run.code} after ${Math.round(run.ms / 1000)}s: ${(run.stderr || run.stdout).slice(-1500)}`);
    }
    console.log(`devin finished in ${Math.round(run.ms / 1000)}s`);
    return run.stdout;
  }
}

const findings = parseFindings(await runReviewer());
const { body, comments } = reviewPayload(findings, commentableLines(files["pr/diff.patch"]));
if (DRY_RUN) {
  console.log(JSON.stringify({ body, comments }, null, 2));
  process.exit(0);
}
const { data: review } = await octokit.rest.pulls.createReview({
  owner,
  repo,
  pull_number: target.number,
  commit_id: target.headSha,
  body,
  event: "COMMENT",
  comments,
});
console.log(`posted ${review.html_url}: ${findings.length} finding(s), ${comments.length} inline`);
