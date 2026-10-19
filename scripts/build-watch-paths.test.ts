import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILD_WATCH_PATHS, PREVIEW_WATCH_PATHS, watches, workersFor } from "./build-watch-paths.ts";

test("目录末尾的 * 跨子目录匹配，根清单只认仓库根那一份", () => {
  assert.equal(watches(BUILD_WATCH_PATHS.core, "workers/core/src/state/deep/file.ts"), true);
  assert.equal(watches(BUILD_WATCH_PATHS.core, "package.json"), true);
  assert.deepEqual(workersFor(["apps/ios/package.json"], BUILD_WATCH_PATHS), []);
  assert.deepEqual(workersFor(["reporters/server-reporter/package.json"], BUILD_WATCH_PATHS), []);
});

test("排除先于包含：shared/ingest 不触发 core，AI 契约只触发 ai 与 site", () => {
  assert.deepEqual(workersFor(["shared/ingest/prepare.ts"], BUILD_WATCH_PATHS), ["site", "ingress", "collector"]);
  assert.deepEqual(workersFor(["shared/god-chat.ts"], BUILD_WATCH_PATHS), ["ai", "site"]);
  assert.deepEqual(workersFor(["shared/json.ts"], BUILD_WATCH_PATHS), ["core", "ai", "site", "ingress", "collector"]);
});

test("前缀通配：scripts/preview-* 触发 core 与 ai，其他脚本只触发 site", () => {
  assert.deepEqual(workersFor(["scripts/preview-worker-name.ts"], BUILD_WATCH_PATHS), ["core", "ai", "site"]);
  assert.deepEqual(workersFor(["scripts/pr-gate.ts"], BUILD_WATCH_PATHS), ["site"]);
});

test("只改文档、skill 与上报器不触发任何构建", () => {
  assert.deepEqual(workersFor(["README.md", "docs/workers-builds.md", ".claude/skills/x/SKILL.md", "reporters/a/b.ts"], BUILD_WATCH_PATHS), []);
  assert.deepEqual(workersFor(["docs/explainer/v2/index.html"], BUILD_WATCH_PATHS), ["site"]);
  assert.deepEqual(workersFor([".github/github-avatar.sha256"], BUILD_WATCH_PATHS), ["site"]);
});

test("分支上只有 core 与 site 构建，core 的 Preview 也盯 ai 与站点代码", () => {
  assert.deepEqual(workersFor(["workers/ai/src/chat/egress.ts"], PREVIEW_WATCH_PATHS), ["core"]);
  assert.deepEqual(workersFor(["src/components/card.tsx"], PREVIEW_WATCH_PATHS), ["core", "site"]);
  assert.deepEqual(workersFor(["workers/collector/src/index.ts", "workers/ingress/src/index.ts"], PREVIEW_WATCH_PATHS), []);
  assert.deepEqual(workersFor(["shared/ingest/prepare.ts"], PREVIEW_WATCH_PATHS), ["site"]);
  assert.deepEqual(workersFor([".github/github-avatar.sha256"], PREVIEW_WATCH_PATHS), []);
});
