import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, ".github/workflows", file), "utf8");

test("告警 issue 跟在 CodeQL 工作流之后，读告警报错时任务报红而不是把清单刷成没有告警", () => {
  const sync = read("codeql-alerts.yml");
  const codeqlName = /^name: (.+)$/m.exec(read("codeql.yml"))?.[1];
  assert.equal(/workflows: \[(.+)\]/.exec(sync)?.[1], codeqlName, "workflow_run 要写 codeql.yml 的 name，改名会让同步悄悄停掉");
  const step = /- name: Read open alerts\n\s+shell: (\S+)[\s\S]*?run: (.+)/.exec(sync);
  assert.equal(step?.[1], "bash", "显式 bash 才带 pipefail");
  assert.match(step?.[2] ?? "", /\| jq -s \. > "\$RUNNER_TEMP\/alerts\.json"$/);
  const update = /- name: Update the alert issue[\s\S]*?shell: (\S+)/.exec(sync);
  assert.equal(update?.[1], "bash");
  assert.match(sync, /gh issue create [^\n]*--label Automation/);
});
