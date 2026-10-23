import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const verify = readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
const rerun = readFileSync(new URL("../.github/workflows/verify-rerun.yml", import.meta.url), "utf8");

function onBlock(workflow: string) {
  const start = workflow.indexOf("\non:\n");
  const end = workflow.indexOf("\npermissions:", start);
  assert.ok(start >= 0 && end > start);
  return workflow.slice(start, end);
}

function runScript(workflow: string) {
  const marker = "run: |\n";
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0);
  const lines: string[] = [];
  for (const line of workflow.slice(start + marker.length).split("\n")) {
    if (line !== "" && !line.startsWith("          ")) break;
    lines.push(line.slice(10));
  }
  return lines.join("\n");
}

test("verify.yml 只由 pull_request 触发，不在默认分支的缓存范围里执行 PR 代码", () => {
  const keys = [...onBlock(verify).matchAll(/^ {2}([A-Za-z0-9_-]+):/gm)].map((match) => match[1]);
  assert.deepEqual(keys, ["pull_request"]);
  assert.doesNotMatch(verify, /inputs\.pr/);
});

test("手动重跑只给 PR 贴 rerun-verify，不检出也不执行 PR 里的代码", () => {
  assert.deepEqual([...onBlock(rerun).matchAll(/^ {2}([A-Za-z0-9_-]+):/gm)].map((match) => match[1]), ["workflow_dispatch"]);
  const label = /LABEL: ([a-z0-9-]+)/.exec(rerun)?.[1];
  assert.equal(label, "rerun-verify");
  assert.match(verify, /github.event.action == 'labeled' && github.event.label.name == 'rerun-verify'/);
  assert.match(verify, /github.event.label.name != 'rerun-verify'/);
  assert.doesNotMatch(rerun, /actions\/checkout|actions\/cache|actions\/setup-node|pnpm\/action-setup|needs\.plan\.outputs/);
  const script = runScript(rerun);
  assert.match(script, /gh pr edit "\$PR" --add-label "\$LABEL"/);
  assert.doesNotMatch(script, /git |pnpm |npm |node /);
  assert.match(rerun, /GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}/);
  assert.doesNotMatch(rerun, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  const parsed = spawnSync("bash", ["-n"], { input: script });
  assert.equal(parsed.status, 0, parsed.stderr.toString());
});
