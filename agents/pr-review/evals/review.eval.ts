import { readFileSync } from "node:fs";
import { defineEval } from "@grok/agent-sdk/evals";
import { type PullTarget, reviewWorkspace } from "../bot/lib/workspace.js";
import { gitSource } from "./git-source.js";

const REPS = Number(process.env.REVIEW_EVAL_REPS ?? "1");

type Case = PullTarget & { id: string; split: "train" | "val" | "test" };

const cases: Case[] = JSON.parse(readFileSync(new URL("./data/cases.json", import.meta.url), "utf8")).cases;

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
