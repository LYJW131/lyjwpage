import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import test from "node:test";

import { isRulePath } from "./rule-drift.ts";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);

function imports(file: string) {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => /^@(\S+\.md)\s*$/.exec(line)?.[1] ?? [])
    .map((target) => normalize(join(dirname(file), target)));
}

test("会载入上下文的规则文件都在漂移检查范围里", () => {
  const entries = tracked.filter((file) => /(^|\/)(CLAUDE|AGENTS)\.md$/.test(file));
  const loaded = [...entries.flatMap(imports), ...tracked.filter((file) => file.startsWith(".claude/rules/") && file.endsWith(".md"))];
  assert.ok(loaded.includes("REVIEW.md"));
  assert.deepEqual(loaded.filter((file) => !isRulePath(file)), []);
});
