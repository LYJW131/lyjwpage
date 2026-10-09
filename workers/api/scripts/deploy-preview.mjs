#!/usr/bin/env node
// 空库不能重放生产的命名空间转移迁移，Preview 必须折叠为直接创建现存类。
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { experimental_readRawConfig } from "wrangler";

import { PREVIEW_WORKER_SCRIPTS, previewWorkerName, previewWorkerOrigin } from "../../../scripts/preview-worker-name.mjs";

const PREVIEW_BASELINE = { tag: "v2-split-online-counter", new_sqlite_classes: ["LivePushRoom", "StateHub"] };

function previewMigrations(migrations) {
  const cut = migrations.findIndex((migration) => migration.tag === PREVIEW_BASELINE.tag);
  if (cut === -1) throw new Error(`wrangler.toml 里找不到迁移 ${PREVIEW_BASELINE.tag}`);
  return [PREVIEW_BASELINE, ...migrations.slice(cut + 1)];
}

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { "worker-name": { type: "string", default: "api" } } });
const workerName = values["worker-name"];
if (!PREVIEW_WORKER_SCRIPTS.includes(workerName)) throw new Error(`Unknown Preview Worker: ${workerName}`);

const branch = process.env.WORKERS_CI_BRANCH?.trim() ?? "";
const name = previewWorkerName(branch);
if (!name) {
  console.log(`[preview] 分支 ${JSON.stringify(branch)} 不部署 Preview`);
  process.exit(0);
}

const { rawConfig } = experimental_readRawConfig({ config: resolve(apiDir, "wrangler.toml") });
const commitSha = process.env.WORKERS_CI_COMMIT_SHA?.trim() || execFileSync("git", ["rev-parse", "HEAD"], { cwd: apiDir, encoding: "utf8" }).trim();
const previewConfig = resolve(apiDir, "wrangler.preview.json");
writeFileSync(previewConfig, JSON.stringify({
  ...rawConfig,
  name: workerName,
  main: "src/preview-entry.ts",
  services: [],
  previews: {
    ...rawConfig.previews,
    services: [],
    vars: { ...rawConfig.previews?.vars, PREVIEW_COMMIT_SHA: commitSha },
  },
  // 同账号 fetch 默认绕过 Worker；自定义域无源站，Preview 必须启用公开路由以免 522。
  compatibility_flags: [...new Set([...(rawConfig.compatibility_flags ?? []), "global_fetch_strictly_public"])],
  migrations: previewMigrations(rawConfig.migrations ?? []),
}, null, 2));

const wrangler = resolve(apiDir, "node_modules/wrangler/bin/wrangler.js");
let result;
try {
  result = spawnSync(process.execPath, [
    wrangler,
    "preview",
    "--config",
    previewConfig,
    "--name",
    name,
    "--worker-name",
    workerName,
  ], { cwd: apiDir, stdio: "inherit" });
} finally {
  rmSync(previewConfig, { force: true });
}

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[preview] ${previewWorkerOrigin(branch, workerName)} (${commitSha.slice(0, 8)})`);
