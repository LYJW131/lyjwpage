import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import lyjwpage, { apiMergesPull, commandsOf, contextFor, ghMergeInputs, loadRules } from "../.pi/extensions/lyjwpage.ts";

const root = path.resolve(import.meta.dirname, "..");

type Handler = (event: unknown, ctx: { cwd: string }) => unknown;

function toolCall() {
  const handlers = new Map<string, Handler>();
  lyjwpage({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as never);
  const handler = handlers.get("tool_call")!;
  return async (command: string) =>
    (await handler({ toolName: "bash", toolCallId: "t", input: { command } }, { cwd: root })) as { block: true; reason: string } | undefined;
}

test("bash -c、sh -lc 与 eval 包着的命令也展开检查", () => {
  assert.ok(commandsOf("bash -c 'wrangler deploy'").includes("wrangler deploy"));
  assert.ok(commandsOf(`sh -lc "eval 'cf deploy'"`).includes("cf deploy"));
});

test("同一条命令里的每次 gh pr merge 都认出来", () => {
  const merges = ghMergeInputs("gh pr merge 1 -R other/x --squash && bash -c 'gh pr merge 668 --rebase'");
  assert.deepEqual(merges.map((m) => [m.owner, m.repo, m.pullNumber, m.merge_method]), [
    ["other", "x", 1, "squash"],
    ["lyjw131", "lyjwpage", 668, "rebase"],
  ]);
});

test("带主机名的 --repo 与 PR URL 按 gh 的格式归一", () => {
  const [hosted] = ghMergeInputs("gh pr merge 2 --repo github.com/lyjw131/lyjwpage --rebase");
  assert.deepEqual([hosted.owner, hosted.repo], ["lyjw131", "lyjwpage"]);
  const [url] = ghMergeInputs("gh pr merge https://github.com/other/x/pull/5 --squash");
  assert.deepEqual([url.owner, url.repo, url.pullNumber], ["other", "x", 5]);
  const [enterprise] = ghMergeInputs("gh pr merge 3 -R ghe.example.com/lyjw131/lyjwpage -s");
  assert.equal(enterprise.owner, "ghe.example.com/lyjw131");
});

test("gh api 直接合并的各种写法都认", () => {
  for (const command of [
    "gh api -X PUT repos/lyjw131/lyjwpage/pulls/1/merge",
    "gh api -XPUT repos/lyjw131/lyjwpage/pulls/1/merge",
    "gh api --method=put repos/lyjw131/lyjwpage/pulls/1/merge",
    "bash -c 'gh api --method PUT repos/lyjw131/lyjwpage/pulls/1/merge'",
    "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
  ]) {
    assert.ok(apiMergesPull(command), command);
  }
  assert.ok(!apiMergesPull("gh api repos/lyjw131/lyjwpage/pulls/1"));
});

test("tool_call 拦下包装过的禁区命令与夹带的本仓库合并", async () => {
  const call = toolCall();
  for (const command of [
    "bash -c 'wrangler deploy'",
    "gh pr merge 1 -R other/x --squash && gh pr merge 668 --merge",
    "gh pr merge 2 --repo github.com/lyjw131/lyjwpage --rebase",
    "gh pr merge $PR --squash --match-head-commit abc",
    "gh pr merge 668 --repo \"$REPO\" --squash",
  ]) {
    assert.equal((await call(command))?.block, true, command);
  }
  assert.equal(await call("ls"), undefined);
});

test("经软链新建的 skill 文件也按 .claude/skills 附上 routines 规则", () => {
  const files = contextFor(root, ".agents/skills/not-yet-created/SKILL.md", loadRules(root), new Set());
  assert.ok(files.some((file) => file.endsWith(path.join(".claude", "rules", "routines.md"))), files.join("\n"));
});

test("目标不存在的路径按最近存在的上级目录解析", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-"));
  fs.mkdirSync(path.join(dir, "real", "rules"), { recursive: true });
  fs.writeFileSync(path.join(dir, "real", "rules", "r.md"), "---\npaths:\n  - \"real/**\"\n---\nbody\n");
  fs.symlinkSync("real", path.join(dir, "link"));
  const rules = [{ file: path.join(dir, "real", "rules", "r.md"), globs: ["real/**"] }];
  assert.deepEqual(contextFor(dir, "link/new/file.md", rules, new Set()), [rules[0].file]);
});
