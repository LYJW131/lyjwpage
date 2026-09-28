#!/usr/bin/env node
/**
 * `pnpm build`。Vercel 的分支预览构建先等本分支的 api Worker Preview 能回公开端点，
 * 再跑 `next build`；其余构建直接跑。
 *
 * Workers Builds 和 Vercel 并行，新分支第一次推送时 Vercel 常常先到，预渲染首页按卡
 * 读端点会拿到 404 / 500，整次构建失败。探的是 `/api/status/listening/now`：一条读
 * 状态核心的实时端点，Preview 的空库第一次公开读取还会顺手完成初始化。只改了 api 监视路径以外文件的分支根本
 * 没有 Preview，所以等不到时这次构建连生产，而不是失败。结果经 PREVIEW_BACKEND_URL
 * 交给 next.config.ts：就绪时是 Preview 的源，回退时是空串。
 */
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

// 讲解动画的静态页（public/explainer）是生成物，先出好再让 next build 收进 public
const explainer = spawnSync(process.execPath, ["scripts/build-explainer.mjs"], { stdio: "inherit", env });
if (explainer.status !== 0) process.exit(explainer.status ?? 1);

const result = spawnSync("next", ["build"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
