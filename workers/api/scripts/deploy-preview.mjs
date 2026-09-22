#!/usr/bin/env node
/**
 * `api` 的 Preview 命令。执行 `wrangler preview`，按分支开一份隔离环境，
 * 不发布生产版本。main 直接成功退出。
 *
 * 每个 Preview 的 Durable Object 是空库，wrangler 会把全部迁移从头上传。生产的
 * v1 / v2 是从旧 `ingest` 搬数据的历史步骤（v1 里 OnlineCounterRoom 同时是新建和
 * 转移的目标），从头执行会被拒绝（10021）。所以这里生成一份 Preview 专用配置：
 * 这两步折成一步直接新建现存的类，之后的迁移原样保留。生产配置和部署不受影响。
 */
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { experimental_readRawConfig } from "wrangler";

import { previewWorkerName, previewWorkerOrigin } from "../../../scripts/preview-worker-name.mjs";

/** 折叠到这个标签为止；新迁移追加在它后面，Preview 照常逐条执行。 */
const PREVIEW_BASELINE = { tag: "v2-split-online-counter", new_sqlite_classes: ["LivePushRoom", "StateHub"] };

function previewMigrations(migrations) {
  const cut = migrations.findIndex((migration) => migration.tag === PREVIEW_BASELINE.tag);
  if (cut === -1) throw new Error(`wrangler.toml 里找不到迁移 ${PREVIEW_BASELINE.tag}`);
  return [PREVIEW_BASELINE, ...migrations.slice(cut + 1)];
}

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const branch = process.env.WORKERS_CI_BRANCH?.trim() ?? "";
const name = previewWorkerName(branch);
if (!name) {
  console.log(`[preview] 分支 ${JSON.stringify(branch)} 不部署 Preview`);
  process.exit(0);
}

const { rawConfig } = experimental_readRawConfig({ config: resolve(apiDir, "wrangler.toml") });
// 与 wrangler.toml 同目录，main、alias 等相对路径照旧解析；用完即删。
const previewConfig = resolve(apiDir, "wrangler.preview.json");
writeFileSync(previewConfig, JSON.stringify({
  ...rawConfig,
  // 同账号的 zone 默认绕过其上的 Worker 直连源站；api.homepage.lyjw.llc 是自定义域、没有源站，
  // 不加这个开关 UPSTREAM_API_URL 一律 522，Preview 取不到生产数据。只加在 Preview 上。
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
    "api",
  ], { cwd: apiDir, stdio: "inherit" });
} finally {
  rmSync(previewConfig, { force: true });
}

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[preview] ${previewWorkerOrigin(branch)}`);
