#!/usr/bin/env node
/**
 * PR 关闭时删掉对应 Worker Preview。没有令牌或 Preview 本来就不存在时成功退出。
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { previewWorkerName } from "../../../scripts/preview-worker-name.mjs";
import { previewWranglerBin } from "./preview-wrangler-bin.mjs";

const branch = (process.env.PREVIEW_BRANCH ?? process.env.WORKERS_CI_BRANCH ?? "").trim();
const name = previewWorkerName(branch);
if (!name) {
  console.log(`[preview] 分支 ${JSON.stringify(branch)} 没有 Preview`);
  process.exit(0);
}
if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
  console.log("[preview] 未配置 CLOUDFLARE_API_TOKEN，留下 Preview");
  process.exit(0);
}

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = previewWranglerBin();
const env = { ...process.env };
if (env.WRANGLER_CI_OVERRIDE_NAME && env.WRANGLER_CI_OVERRIDE_NAME !== "api") {
  delete env.WRANGLER_CI_OVERRIDE_NAME;
}
const result = spawnSync(process.execPath, [
  wrangler,
  "preview",
  "delete",
  "--name",
  name,
  "--worker-name",
  "api",
  "--skip-confirmation",
], { cwd: apiDir, encoding: "utf8", env });

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (output) process.stdout.write(output);
if (result.status === 0) process.exit(0);
if (/not found|does not exist|10025/i.test(output)) {
  console.log(`[preview] ${name} 不存在，跳过`);
  process.exit(0);
}
process.exit(result.status ?? 1);
