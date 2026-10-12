#!/usr/bin/env node
// Workers Builds 的预览构建要等本分支同提交的 api Preview；等不到直接失败，不回退生产后端。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const envFile = new URL("../.env.local", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

import { isMatchingPreview } from "./preview-backend.mjs";
import { previewWorkerOrigin } from "./preview-worker-name.mjs";
import { SITE_PREVIEW_MANIFEST_PATH, sitePreviewManifest } from "./site-preview.mjs";

const WAIT_MS = 180_000;
const POLL_MS = 10_000;

async function waitForPreview(origin, commitSha) {
  if (!commitSha) return null;
  const deadline = Date.now() + WAIT_MS;
  while (true) {
    if (await isMatchingPreview(origin, commitSha)) return origin;
    console.log(`[preview] 等待本分支 ${commitSha.slice(0, 8)} 的 Worker Preview`);
    if (Date.now() + POLL_MS > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const env = { ...process.env };
const branch = process.env.WORKERS_CI_BRANCH?.trim() || "";
const preview = Boolean(branch && branch !== "main");
const commit = process.env.WORKERS_CI_COMMIT_SHA?.trim()
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
env.COMMIT_SHA = commit;
env.BUILD_TIME = new Date().toISOString();
env.COMMIT_MESSAGE = execFileSync("git", ["show", "-s", "--format=%s", commit], { encoding: "utf8" }).trim().slice(0, 180);

mkdirSync("build", { recursive: true });
writeFileSync(SITE_PREVIEW_MANIFEST_PATH, `${JSON.stringify({ version: 1, mode: "building", branch, commit, backendUrl: null }, null, 2)}\n`);

let backendUrl = null;
if (preview) {
  env.PUBLIC_CF_WEB_ANALYTICS_TOKENS = "";
  backendUrl = await waitForPreview(previewWorkerOrigin(branch), commit);
  if (!backendUrl) {
    console.error(`[preview] 等不到本分支 ${commit.slice(0, 8)} 的 Worker Preview，构建失败；预览构建不回退生产后端`);
    process.exit(1);
  }
  env.PREVIEW_BACKEND_URL = backendUrl;
  console.log(`[preview] 后端用 ${backendUrl}`);
}

const explainer = spawnSync(process.execPath, ["scripts/build-explainer.mjs"], { stdio: "inherit", env });
if (explainer.status !== 0) process.exit(explainer.status ?? 1);

const assets = spawnSync(
  process.execPath,
  ["--import", "tsx", "--import", "./src/lib/testing/register-alias.mjs", "scripts/build-site-assets.tsx"],
  { stdio: "inherit", env },
);
if (assets.status !== 0) process.exit(assets.status ?? 1);

const result = spawnSync("react-router", ["build"], { stdio: "inherit", env });
if (result.status !== 0) process.exit(result.status ?? 1);

const manifest = sitePreviewManifest({ branch, commit, backendUrl });
writeFileSync(SITE_PREVIEW_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
process.exit(0);
