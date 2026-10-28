import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { defineEval } from "@grok/agent-sdk/evals";
import { type PullTarget, type Source, reviewWorkspace } from "../bot/lib/workspace.js";

const run = promisify(execFile);
const REPO_DIR = process.env.REVIEW_EVAL_REPO ?? new URL("../../..", import.meta.url).pathname;
const REPS = Number(process.env.REVIEW_EVAL_REPS ?? "1");

type Case = PullTarget & { id: string; split: "train" | "val" | "test" };

const cases: Case[] = JSON.parse(readFileSync(new URL("./data/cases.json", import.meta.url), "utf8")).cases;

async function git(args: string[], encoding: "utf8" | "buffer") {
  const { stdout } = await run("git", ["-C", REPO_DIR, ...args], { encoding, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

async function ensureCommit(sha: string) {
  try {
    await git(["cat-file", "-e", `${sha}^{commit}`], "utf8");
  } catch {
    await git(["fetch", "--quiet", "origin", sha], "utf8");
  }
}

// 评测用本地 git 代替 GitHub API 取同一份 diff 与源码树，喂给模型的文件与线上一致。
function gitSource(target: PullTarget): Source {
  return {
    async diff() {
      await Promise.all([ensureCommit(target.baseSha), ensureCommit(target.headSha)]);
      return String(await git(["diff", "--no-color", "--no-ext-diff", `${target.baseSha}...${target.headSha}`], "utf8"));
    },
    async tarball() {
      await ensureCommit(target.headSha);
      return Buffer.from(await git(["archive", "--format=tar.gz", "--prefix=snapshot/", target.headSha], "buffer"));
    },
  };
}

// 与 `bot/channels/github.ts` 开轮时的消息同形：SDK 默认的 PR 触发消息加上 context 那一行。
function trigger(target: PullTarget) {
  return [
    `GitHub pull request trigger: ${target.owner}/${target.repo}#${target.number}`,
    "Action: opened",
    `PR: https://github.com/${target.owner}/${target.repo}/pull/${target.number}`,
    `Title: ${target.title}`,
    `Head: pr-${target.number} (${target.headSha})`,
    "Base: main",
    `Author: ${target.author}`,
    "",
    "Handle this pull request event.",
    "Review this pull request. Start with pr/meta.md and pr/diff.patch.",
  ].join("\n");
}

export default defineEval({
  tags: ["review"],
  timeoutMs: 20 * 60_000,
  cases: cases.map((item) => ({
    id: item.id,
    tags: [item.split],
    iterations: REPS,
    metadata: { pr: item.number, headSha: item.headSha },
    async test(t) {
      await t.send(trigger(item), { workspaceFiles: await reviewWorkspace(gitSource(item), item) });
      t.succeeded();
      t.calledTool("post_findings", { count: 1 });
    },
  })),
});
