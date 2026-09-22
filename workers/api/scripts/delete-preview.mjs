#!/usr/bin/env node
/**
 * PR 关闭时删掉对应影子 Worker。没有令牌或脚本本来就不存在时成功退出，
 * 不把「还没配清理令牌」报成检查失败。
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { previewWorkerName } from "../../../scripts/preview-worker-name.mjs";

const branch = (process.env.PREVIEW_BRANCH ?? process.env.WORKERS_CI_BRANCH ?? "").trim();
const name = previewWorkerName(branch);
if (!name) {
  console.log(`[preview] 分支 ${JSON.stringify(branch)} 没有影子 Worker`);
  process.exit(0);
}
if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
  console.log("[preview] 未配置 CLOUDFLARE_API_TOKEN，留下影子 Worker");
  process.exit(0);
}

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(apiDir, "node_modules/wrangler/bin/wrangler.js");
const result = spawnSync(process.execPath, [
  wrangler,
  "delete",
  "--config",
  "wrangler.preview.toml",
  "--name",
  name,
  "--force",
], { cwd: apiDir, encoding: "utf8" });

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (output) process.stdout.write(output);
if (result.status === 0) process.exit(0);
if (/not found|does not exist|10007/i.test(output)) {
  console.log(`[preview] ${name} 不存在，跳过`);
  process.exit(0);
}
process.exit(result.status ?? 1);
