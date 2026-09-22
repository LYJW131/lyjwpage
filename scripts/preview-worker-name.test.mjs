import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { previewWorkerName, previewWorkerOrigin } from "./preview-worker-name.mjs";

test("分支名变成稳定的影子 Worker 名", () => {
  assert.equal(previewWorkerName("feat/agent-status"), "api-preview-feat-agent-status");
  assert.equal(previewWorkerName("  Codex/Fix-Pulse  "), "api-preview-codex-fix-pulse");
  assert.equal(
    previewWorkerOrigin("feat/agent-status"),
    "https://api-preview-feat-agent-status.lyjw.workers.dev",
  );
});

test("main 和空分支不分配影子 Worker", () => {
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
  assert.equal(name.length <= 63, true);
  assert.match(name, /^api-preview-[a-z0-9-]+-[0-9a-f]{8}$/);
  assert.equal(name.endsWith("-"), false);
  assert.equal(previewWorkerName(branch), name);
  assert.notEqual(previewWorkerName(`${branch}-other`), name);
});

test("影子配置不挂生产域名、cron、KV 或 D1", () => {
  const preview = readFileSync(new URL("../workers/api/wrangler.preview.toml", import.meta.url), "utf8");
  const production = readFileSync(new URL("../workers/api/wrangler.toml", import.meta.url), "utf8");
  assert.match(preview, /PREVIEW_WORKER = "true"/);
  assert.match(preview, /UPSTREAM_API_URL = "https:\/\/api\.homepage\.lyjw\.llc"/);
  assert.equal(preview.includes("[triggers]"), false);
  assert.equal(preview.includes("custom_domain"), false);
  assert.equal(preview.includes("kv_namespaces"), false);
  assert.equal(preview.includes("d1_databases"), false);
  assert.equal(preview.includes("r2_buckets"), false);
  assert.equal(preview.includes("6d4a26ae1068417d8f9f7c200381826b"), false);
  assert.equal(production.includes("PREVIEW_WORKER"), false);
  assert.equal(production.includes("UPSTREAM_API_URL"), false);
});
