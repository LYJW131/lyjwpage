#!/usr/bin/env node
/**
 * Workers Builds 的非生产部署命令。按 WORKERS_CI_BRANCH 发布独立脚本，
 * 不碰生产的 api。main 直接成功退出，避免误配时把构建打红。
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { previewWorkerName } from "../../../scripts/preview-worker-name.mjs";

const branch = process.env.WORKERS_CI_BRANCH?.trim() ?? "";
const name = previewWorkerName(branch);
if (!name) {
  console.log(`[preview] 分支 ${JSON.stringify(branch)} 不部署影子 Worker`);
  process.exit(0);
}

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(apiDir, "node_modules/wrangler/bin/wrangler.js");
const result = spawnSync(process.execPath, [
  wrangler,
  "deploy",
  "--config",
  "wrangler.preview.toml",
  "--name",
  name,
], { cwd: apiDir, stdio: "inherit" });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[preview] https://${name}.lyjw.workers.dev`);
