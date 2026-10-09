#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PREVIEW_WORKER_SCRIPTS, previewWorkerName } from "../../../scripts/preview-worker-name.mjs";

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
const wrangler = resolve(apiDir, "node_modules/wrangler/bin/wrangler.js");
let exitCode = 0;
for (const workerName of PREVIEW_WORKER_SCRIPTS) {
  const result = spawnSync(process.execPath, [
    wrangler,
    "preview",
    "delete",
    "--name",
    name,
    "--worker-name",
    workerName,
    "--skip-confirmation",
  ], { cwd: apiDir, encoding: "utf8" });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (output) process.stdout.write(output);
  if (result.status === 0) continue;
  if (/not found|does not exist|10025/i.test(output)) {
    console.log(`[preview] ${workerName}/${name} 不存在，跳过`);
    continue;
  }
  exitCode = result.status ?? 1;
}
process.exit(exitCode);
