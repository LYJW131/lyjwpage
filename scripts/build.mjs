#!/usr/bin/env node
// Vercel 和 Worker 并行构建会竞态；先等预览后端，未触发预览的分支超时后回退生产读取。
import { spawnSync } from "node:child_process";

import { previewWorkerOrigin } from "./preview-worker-name.mjs";

const WAIT_MS = 3 * 60_000;
const READY_PATH = "/api/status/listening/now";
const POLL_MS = 10_000;

async function waitForPreview(origin) {
  const deadline = Date.now() + WAIT_MS;
  while (true) {
    try {
      const response = await fetch(`${origin}${READY_PATH}`, { signal: AbortSignal.timeout(25_000) });
      if (response.ok) return true;
      console.log(`[preview] ${origin}${READY_PATH} → ${response.status}`);
    } catch (error) {
      console.log(`[preview] ${origin}${READY_PATH} → ${error instanceof Error ? error.message : String(error)}`);
    }
    if (Date.now() + POLL_MS > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const env = { ...process.env };
const origin = process.env.VERCEL_ENV === "preview" ? previewWorkerOrigin(process.env.VERCEL_GIT_COMMIT_REF ?? "") : null;
if (origin) {
  const ready = await waitForPreview(origin);
  env.PREVIEW_BACKEND_URL = ready ? origin : "";
  console.log(ready ? `[preview] 后端用 ${origin}` : "[preview] 等不到本分支的 Worker Preview，这次构建连生产");
}

const explainer = spawnSync(process.execPath, ["scripts/build-explainer.mjs"], { stdio: "inherit", env });
if (explainer.status !== 0) process.exit(explainer.status ?? 1);

const result = spawnSync("next", ["build"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
