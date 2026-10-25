import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import lyjwpage, { commandsOf, contextFor, expandsAtRuntime, loadRules, mergeArgs, mergesViaShell } from "../.pi/extensions/lyjwpage.ts";

const root = path.resolve(import.meta.dirname, "..");

type Handler = (event: unknown, ctx: { cwd: string }) => unknown;

function extension() {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
  lyjwpage({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerTool: (tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) => tools.set(tool.name, tool),
  } as never);
  const handler = handlers.get("tool_call")!;
  const call = async (command: string) =>
    (await handler({ toolName: "bash", toolCallId: "t", input: { command } }, { cwd: root })) as { block: true; reason: string } | undefined;
  return { call, tools };
}

test("只在 shell 或 eval 真被调用时展开 -c，echo 打印的示例不算", () => {
  assert.ok(commandsOf("bash -c 'wrangler deploy'").includes("wrangler deploy"));
  assert.ok(commandsOf(`sh -lc "eval 'cf deploy'"`).includes("cf deploy"));
  assert.ok(commandsOf("env FOO=1 timeout 5 bash -c 'cf deploy'").includes("cf deploy"));
  assert.deepEqual(commandsOf("echo bash -c 'cf deploy'"), ["echo bash -c 'cf deploy'"]);
});

test("单引号里的 $ 是字面值，双引号里的撇号不开单引号", () => {
  assert.equal(expandsAtRuntime("gh pr view 1 --json title --jq '.title | \"$x\"'"), false);
  assert.equal(expandsAtRuntime('gh pr merge 2 --body "it\'s fine" --repo "$REPO"'), true);
  assert.equal(expandsAtRuntime("gh pr merge $(cat n)"), true);
});

test("bash 里任何写法的合并都拦，交给 lyjwpage_merge_pr", () => {
  for (const command of [
    "gh pr merge 668 --squash",
    "gh -R lyjw131/lyjwpage pr merge 2 --rebase",
    "gh pr merge 2 -R other/x --repo lyjw131/lyjwpage --rebase",
    "gh pr merge 1 -R other/x --squash && bash -c 'gh pr merge 668 --rebase'",
    "G=gh; $G pr merge 2",
    "$(printf gh) pr merge 2",
    "gh api -X PUT repos/lyjw131/lyjwpage/pulls/1/merge",
    "gh api -XPUT repos/lyjw131/lyjwpage/pulls/1/merge",
    "gh -R lyjw131/lyjwpage api --method=put repos/lyjw131/lyjwpage/pulls/1/merge",
    "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
    "gh pr --repo lyjw131/lyjwpage merge 2 --rebase",
    "gh api -X POST repos/lyjw131/lyjwpage/pulls/1/merge",
    `node -e "require('child_process').execFileSync('gh', ['pr', 'merge', '1', '--squash'])"`,
    `python3 -c "import subprocess; subprocess.run(['gh','pr','merge','1'])"`,
  ]) {
    assert.ok(mergesViaShell(command), command);
  }
});

test("查询类 gh 命令与 git merge 不当合并", () => {
  for (const command of [
    "gh pr list --search merge",
    "gh pr create --title merge --body 'pr merge later'",
    "gh api repos/lyjw131/lyjwpage/pulls/1",
    "git merge origin/main",
    "pnpm merge-message 667 'chore: x'",
  ]) {
    assert.ok(!mergesViaShell(command), command);
  }
});

test("合并工具只对本仓库调 gh pr merge，参数不经 shell", () => {
  assert.deepEqual(mergeArgs({ pr: 7, method: "squash", subject: "fix: $HOME `x` (#7)", body: "--repo other/x", expectedHeadSha: "a".repeat(40) }), [
    "pr", "merge", "7", "--repo", "lyjw131/lyjwpage", "--squash",
    "--subject", "fix: $HOME `x` (#7)", "--body", "--repo other/x", "--match-head-commit", "a".repeat(40),
  ]);
});

test("tool_call 拦下包装过的禁区命令与 bash 合并，放行普通命令", async () => {
  const { call, tools } = extension();
  assert.ok(tools.has("lyjwpage_merge_pr"));
  for (const command of ["bash -c 'wrangler deploy'", "gh pr merge 668 --squash --match-head-commit abc"]) {
    assert.equal((await call(command))?.block, true, command);
  }
  assert.equal(await call("ls"), undefined);
  assert.equal(await call("echo bash -c 'cf deploy'"), undefined);
});

test("合并工具在守卫拦下时报错、不调 gh", async () => {
  const { tools } = extension();
  const merge = tools.get("lyjwpage_merge_pr")!;
  await assert.rejects(
    merge.execute("t", { pr: 1, method: "squash", subject: "x", body: "", expectedHeadSha: "0".repeat(40) }, undefined, undefined, { cwd: root }),
    /origin\/main|expectedHeadSha|拦/,
  );
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
