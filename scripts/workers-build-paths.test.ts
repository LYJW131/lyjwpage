import assert from "node:assert/strict";
import { test } from "node:test";
import { compareBuildPaths, expectedWorkers, gitChangedFiles, loadBuildPaths, matchesPath, parseBuildPaths } from "./workers-build-paths.ts";

const config = loadBuildPaths();
const expected = (files: string[], commitCount = 1) => expectedWorkers({ base: "a".repeat(40), files, commitCount }, config);
const snapshot = () => Object.entries(config.workers).map(([worker, paths]) => ({ worker, branch: config.productionBranch, ...structuredClone(paths) }));

test("星号跨目录，正则字符按字面量匹配", () => {
  assert.equal(matchesPath("workers/core/src/stores/state.ts", "workers/core/*"), true);
  assert.equal(matchesPath("docs/a.md", "*.md"), true);
  assert.equal(matchesPath("scripts/preview-backend.mjs", "scripts/preview-*"), true);
  assert.equal(matchesPath("src/fooXtsx", "src/foo.tsx"), false);
  assert.equal(matchesPath("src/foo(bar).tsx", "src/foo(bar).tsx"), true);
});

test("生产监视路径按依赖匹配，排除路径优先，不借用 Preview 的范围", () => {
  assert.deepEqual(expected(["src/components/example.tsx"]), ["site"]);
  assert.deepEqual(expected(["workers/ai/src/chat/index.ts"]), ["ai"]);
  assert.deepEqual(expected(["workers/core/src/index.ts"]), ["core"]);
  assert.deepEqual(expected(["shared/ingest/mac.ts"]), ["collector", "ingress", "site"]);
  assert.deepEqual(expected(["shared/god-chat.ts"]), ["ai", "site"]);
  assert.deepEqual(expected(["shared/public-status.ts"]), ["ai", "collector", "core", "ingress", "site"]);
  assert.deepEqual(expected(["docs/workers-builds.md", "HUMAN.md"]), []);
  assert.deepEqual(expected(["pnpm-lock.yaml"]), Object.keys(config.workers).sort());
});

test("空变更、大文件批次和大提交批次必须构建全部 Worker", () => {
  const all = Object.keys(config.workers).sort();
  assert.deepEqual(expected([]), all);
  assert.deepEqual(expected(Array.from({ length: 3000 }, (_, i) => `docs/${i}.md`)), all);
  assert.deepEqual(expected(["docs/example.md"], 20), all);
  assert.deepEqual(expected(["docs/example.md"], 19), []);
});

test("远端路径比对忽略顺序，但拒绝缺失、重复、漂移和无效快照", () => {
  const rows = snapshot();
  for (const row of rows) row.includes.reverse();
  assert.deepEqual(compareBuildPaths(rows, config), []);
  rows[0].includes.push("unplanned/*");
  rows[0].branch = "dev";
  assert.deepEqual(compareBuildPaths(rows, config), [`${rows[0].worker} 生产分支不一致`, `${rows[0].worker} includes 不一致`]);
  assert.ok(compareBuildPaths(rows.slice(1), config).some((message) => message.includes("缺少远端配置")));
  assert.throws(() => compareBuildPaths([rows[0], rows[0]], config), /重复/);
  assert.throws(() => compareBuildPaths({ success: false }, config));
  assert.throws(() => parseBuildPaths({ productionBranch: "main", workers: {} }));
  assert.throws(() => parseBuildPaths({ productionBranch: "main", workers: { site: { includes: ["[a]"], excludes: [] } } }));
});

test("删除与重命名的旧、新路径都能触发各自所属 Worker", () => {
  assert.deepEqual(expected(["workers/ai/src/old.ts", "workers/core/src/new.ts"]), ["ai", "core"]);
  assert.deepEqual(expected(["src/removed.tsx", "docs/moved.md"]), ["site"]);
});

test("Git 差异缺历史或 SHA 非法时拒绝推导", () => {
  assert.throws(() => gitChangedFiles("0".repeat(40)));
  assert.throws(() => gitChangedFiles("HEAD"));
});
