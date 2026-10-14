#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SITE_PREVIEW_MANIFEST_PATH,
  sitePreviewConfig,
  sitePreviewDeployEnv,
  sitePreviewManifest,
  sitePreviewName,
} from "./site-preview.mjs";
import { SITE_PREVIEW_WORKER_SCRIPT } from "./preview-worker-name.ts";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function deploySitePreview({ env = process.env, spawn = spawnSync, log = console.error, root = defaultRoot } = {}) {
  const builtConfigPath = resolve(root, "build/server/wrangler.json");
  const manifestPath = resolve(root, SITE_PREVIEW_MANIFEST_PATH);
  const tempConfigPath = resolve(root, "build/server/wrangler.preview-site.json");
  for (const path of [builtConfigPath, manifestPath]) {
    if (!existsSync(path)) throw new Error(`缺少构建产物 ${path}；先跑 pnpm build`);
  }
  const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (raw?.version !== 1) throw new Error(`site-preview.json 版本 ${JSON.stringify(raw?.version)} 不支持`);
  if (raw.mode !== "preview") throw new Error(`site-preview.json 是 ${raw.mode} 构建，不是预览`);
  const manifest = sitePreviewManifest(raw);
  if (manifest.mode !== "preview" || manifest.branch !== raw.branch) {
    throw new Error("site-preview.json 与预览契约不一致，重新构建");
  }

  const deployEnv = sitePreviewDeployEnv(env);
  if (deployEnv.branch !== manifest.branch || deployEnv.commit !== manifest.commit) {
    throw new Error("WORKERS_CI_BRANCH / WORKERS_CI_COMMIT_SHA 与构建时的冻结记录不一致，重新构建");
  }

  const built = JSON.parse(readFileSync(builtConfigPath, "utf8"));
  writeFileSync(tempConfigPath, `${JSON.stringify(sitePreviewConfig(built, manifest), null, 2)}\n`);
  try {
    const wrangler = existsSync(resolve(root, "node_modules/wrangler/bin/wrangler.js"))
      ? resolve(root, "node_modules/wrangler/bin/wrangler.js")
      : "wrangler";
    const result = spawn(process.execPath, [
      wrangler, "preview",
      "--config", tempConfigPath,
      "--name", sitePreviewName(manifest),
      "--worker-name", SITE_PREVIEW_WORKER_SCRIPT,
    ], { cwd: root, stdio: "inherit", env });
    if (result.status !== 0) {
      log(`[preview] wrangler preview 退出码 ${result.status ?? "unknown"}`);
      process.exitCode = result.status ?? 1;
    }
  } finally {
    rmSync(tempConfigPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deploySitePreview();
}
