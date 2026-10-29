import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, ".github/workflows", file), "utf8");

test("告警导出跟在 CodeQL 工作流之后，接口报错时任务报红而不是导出空数组", () => {
  const exporter = read("codeql-alerts.yml");
  const codeqlName = /^name: (.+)$/m.exec(read("codeql.yml"))?.[1];
  assert.equal(/workflows: \[(.+)\]/.exec(exporter)?.[1], codeqlName, "workflow_run 要写 codeql.yml 的 name，改名会让导出悄悄停掉");
  const step = /- shell: (\S+)[\s\S]*?run: (.+)/.exec(exporter);
  assert.equal(step?.[1], "bash", "显式 bash 才带 pipefail");
  assert.match(step?.[2] ?? "", /\| jq -s \. > codeql-alerts\.json$/);
});
