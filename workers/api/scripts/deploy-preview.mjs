#!/usr/bin/env node
/**
 * `api` 的 Preview 命令。执行 `wrangler preview`，按分支开一份隔离环境，
 * 不发布生产版本。main 直接成功退出。
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { previewWorkerName, previewWorkerOrigin } from "../../../scripts/preview-worker-name.mjs";

const branch = process.env.WORKERS_CI_BRANCH?.trim() ?? "";
const name = previewWorkerName(branch);
if (!name) {
  console.log(`[preview] 分支 ${JSON.stringify(branch)} 不部署 Preview`);
  process.exit(0);
}

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(apiDir, "node_modules/wrangler/bin/wrangler.js");
const result = spawnSync(process.execPath, [
  wrangler,
  "preview",
  "--name",
  name,
  "--worker-name",
  "api",
], { cwd: apiDir, stdio: "inherit" });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[preview] ${previewWorkerOrigin(branch)}`);
