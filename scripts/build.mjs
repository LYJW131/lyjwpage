#!/usr/bin/env node
// Vercel 和 Worker 并行构建会竞态；先等预览后端，未触发预览的分支超时后回退生产读取。
import { spawnSync } from "node:child_process";

import { findMatchingPreview } from "./preview-backend.mjs";
import { PREVIEW_WORKER_SCRIPTS, previewWorkerOrigin } from "./preview-worker-name.mjs";

const WAIT_MS = 3 * 60_000;
const POLL_MS = 10_000;

async function waitForPreview(origins, commitSha) {
  if (!commitSha) return null;
  const deadline = Date.now() + WAIT_MS;
  while (true) {
    const origin = await findMatchingPreview(origins, commitSha);
    if (origin) return origin;
    console.log(`[preview] 等待本分支 ${commitSha.slice(0, 8)} 的 Worker Preview`);
    if (Date.now() + POLL_MS > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const env = { ...process.env };
if (process.env.VERCEL_ENV === "preview") {
  const origins = PREVIEW_WORKER_SCRIPTS.map((worker) => previewWorkerOrigin(process.env.VERCEL_GIT_COMMIT_REF ?? "", worker)).filter(Boolean);
  const origin = origins.length ? await waitForPreview(origins, process.env.VERCEL_GIT_COMMIT_SHA?.trim()) : null;
  env.PREVIEW_BACKEND_URL = origin ?? "";
  console.log(origin ? `[preview] 后端用 ${origin}` : "[preview] 等不到本次提交的 Worker Preview，这次构建连生产");
}

const explainer = spawnSync(process.execPath, ["scripts/build-explainer.mjs"], { stdio: "inherit", env });
if (explainer.status !== 0) process.exit(explainer.status ?? 1);

const result = spawnSync("next", ["build"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
