import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

function onBlock(source: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === "on:" || line.startsWith("on: "));
  if (start < 0) throw new Error("missing on:");
  const block: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i > start && line !== "" && !line.startsWith(" ") && !line.startsWith("#")) break;
    if (line.trimStart().startsWith("#")) continue;
    block.push(line);
  }
  return block.join("\n");
}

const GATE = "github.event.label.name == 'reverify' && github.actor == 'lyjw131[bot]'";

test("检出 PR head 的验证只挂 pull_request，手跑不执行 PR 代码", () => {
  const verify = read(".github/workflows/verify.yml");
  const dispatch = read(".github/workflows/verify-dispatch.yml");
  const ci = read(".github/workflows/ci.yml");
  const verifyOn = onBlock(verify);
  const dispatchOn = onBlock(dispatch);
  assert.equal(verifyOn.includes("workflow_dispatch"), false);
  assert.match(verifyOn, /\bpull_request:/);
  assert.match(verify, /ref: \$\{\{ needs\.plan\.outputs\.head \}\}/);
  assert.equal(verify.split(GATE).length - 1, 2);
  assert.match(dispatchOn, /\bworkflow_dispatch:/);
  assert.equal(dispatchOn.includes("pull_request"), false);
  assert.equal(dispatch.includes("actions/checkout"), false);
  assert.equal(dispatch.includes("needs.plan.outputs.head"), false);
  assert.match(dispatch, /^ {10}LABEL: reverify$/m);
  assert.equal(/\b(git|pnpm|npm|node)\b/.test(dispatch), false);
  assert.match(ci, /github\.event\.label\.name == 'reverify' && '-noop'/);
  assert.match(ci, /github\.event\.label\.name != 'reverify'/);
});
