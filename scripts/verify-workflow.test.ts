import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WRITE_TRIGGERS = ["workflow_dispatch", "push", "schedule", "workflow_call", "repository_dispatch"];

test("verify.yml 只由 pull_request 触发，检出 PR head 的 job 写不到默认分支的 Actions 缓存", () => {
  const workflow = readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  const on = /^on:\n(?: {2}.*\n)*/m.exec(workflow)?.[0] ?? "";
  assert.match(on, /pull_request:/);
  for (const trigger of WRITE_TRIGGERS) assert.doesNotMatch(on, new RegExp(`^\\s+${trigger}:`, "m"));
  assert.match(workflow, /ref: \$\{\{ needs\.plan\.outputs\.head \}\}/);
  assert.doesNotMatch(workflow, /inputs\.pr/);
});
