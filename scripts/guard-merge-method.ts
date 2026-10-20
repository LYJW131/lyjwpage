#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { mergeMethodFor } from "./merge-message.ts";

const REPO = { owner: "lyjw131", repo: "lyjwpage" };

type MergeInput = { owner?: unknown; repo?: unknown; merge_method?: unknown; expectedHeadSha?: unknown };

const countCommits = (sha: string, cwd: string) =>
  Number(execFileSync("git", ["rev-list", "--count", "--no-merges", `origin/main..${sha}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());

export function mergeMethodReason(input: MergeInput, count: (sha: string) => number): string | null {
  if (String(input.owner).toLowerCase() !== REPO.owner || String(input.repo).toLowerCase() !== REPO.repo) return null;
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
  const expected = mergeMethodFor(commits);
  if (input.merge_method === expected) return null;
  return `这个 PR 有 ${commits} 个非合并提交，merge_method 要用 ${expected}（少于 3 个压缩合并，3 个及以上用合并提交），照 pnpm merge-message 输出的 merge_method 传。`;
}

function main() {
  let input: { tool_input?: MergeInput };
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    process.stderr.write("已拦下：读不懂合并调用的参数。\n");
    process.exit(2);
  }
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const reason = mergeMethodReason(input.tool_input ?? {}, (sha) => countCommits(sha, cwd));
  if (reason === null) return;
  process.stderr.write(`已拦下：${reason}\n`);
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
