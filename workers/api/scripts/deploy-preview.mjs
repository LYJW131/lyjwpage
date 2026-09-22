#!/usr/bin/env node
/**
 * Workers Builds 的非生产部署命令。在生产脚本 `api` 上创建或更新该分支的
 * Worker Preview，不发布生产版本。main 直接成功退出。
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
/**
 * Workers Builds 用 WRANGLER_CI_OVERRIDE_NAME 指定 Worker 名，而且它压过
 * --worker-name。预览必须落在生产脚本 api 上；连到别的构建项目时清掉覆盖。
 */
const env = { ...process.env };
if (env.WRANGLER_CI_OVERRIDE_NAME && env.WRANGLER_CI_OVERRIDE_NAME !== "api") {
  delete env.WRANGLER_CI_OVERRIDE_NAME;
}
const result = spawnSync(process.execPath, [
  wrangler,
  "preview",
  "--name",
  name,
  "--worker-name",
  "api",
], { cwd: apiDir, stdio: "inherit", env });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`[preview] ${previewWorkerOrigin(branch)}`);
