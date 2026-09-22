import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { previewWorkerName, previewWorkerOrigin } from "./preview-worker-name.mjs";

test("分支名变成稳定的 Preview 名和地址", () => {
  assert.equal(previewWorkerName("feat/agent-status"), "feat-agent-status");
  assert.equal(previewWorkerName("  Codex/Fix-Pulse  "), "codex-fix-pulse");
  assert.equal(
    previewWorkerOrigin("feat/agent-status"),
    "https://feat-agent-status-api.lyjw.workers.dev",
  );
});

test("main 和空分支不分配 Preview", () => {
  assert.equal(previewWorkerName("main"), null);
  assert.equal(previewWorkerName("Main"), null);
  assert.equal(previewWorkerName(""), null);
  assert.equal(previewWorkerName("///"), null);
  assert.equal(previewWorkerOrigin("main"), null);
});

test("超长分支名截到 DNS 标签上限，两次结果相同", () => {
  const branch = `feat/${"segment-".repeat(20)}tail`;
  const name = previewWorkerName(branch);
  assert.ok(name);
  const label = `${name}-api`;
  assert.equal(label.length <= 63, true);
  assert.match(name, /^[a-z0-9-]+-[0-9a-f]{8}$/);
  assert.equal(name.endsWith("-"), false);
  assert.equal(previewWorkerName(branch), name);
  assert.notEqual(previewWorkerName(`${branch}-other`), name);
});

test("Preview 配置挂在生产 wrangler.toml 里，不带生产域名、cron、KV 或 D1", () => {
  const production = readFileSync(new URL("../workers/api/wrangler.toml", import.meta.url), "utf8");
  const [top, previews] = production.split("[previews.vars]");
  assert.ok(previews);
  assert.equal(/^\s*PREVIEW_WORKER\s*=/m.test(top), false);
  assert.equal(/^\s*UPSTREAM_API_URL\s*=/m.test(top), false);
  assert.match(previews, /PREVIEW_WORKER = "true"/);
  assert.match(previews, /UPSTREAM_API_URL = "https:\/\/api\.homepage\.lyjw\.llc"/);
  assert.match(previews, /name = "STATE"/);
  assert.match(previews, /name = "LIVE_PUSH"/);
  assert.equal(previews.includes("[triggers]"), false);
  assert.equal(previews.includes("custom_domain"), false);
  assert.equal(previews.includes("kv_namespaces"), false);
  assert.equal(previews.includes("d1_databases"), false);
  assert.equal(previews.includes("r2_buckets"), false);
  assert.equal(previews.includes("6d4a26ae1068417d8f9f7c200381826b"), false);
});
