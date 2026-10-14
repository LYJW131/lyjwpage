#!/usr/bin/env node
// 构建产物 build/client/assets 整份存进 R2，site Worker 在当前版本缺这个文件时从这里读（src/lib/asset-archive.ts）。
// Workers 静态资源只留当前版本：缓存优先恢复的旧 HTML 引用的旧指纹文件不存档就 404。
// Vite 的文件名带内容哈希，同名即同内容：每次构建整份覆盖上传，既刷新桶上前缀过期规则的计时（docs/ops-facts.md），
// 也不会冲掉别的版本。上传失败只告警不让构建失败：缺档时旧页面还有 asset-recovery-boot 兜底刷新。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { archivedAssetContentType, archivedAssetKey } from "../src/lib/asset-archive.ts";

export const ARCHIVE_BUCKET = "lyjw-homepage";
const API = "https://api.cloudflare.com/client/v4";
const CONCURRENCY = 6;
const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

export function archivePlan(dir) {
  const files = [];
  const skipped = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith(".map")) continue;
    const key = archivedAssetKey(`/assets/${name}`);
    const contentType = archivedAssetContentType(name);
    if (!key || !contentType) {
      skipped.push(name);
      continue;
    }
    files.push({ name, key, contentType, file: path.join(dir, name) });
  }
  return { files, skipped };
}

async function accountIdFor(token, fetchImpl) {
  const response = await fetchImpl(`${API}/accounts?per_page=2`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  const accounts = body?.result ?? [];
  return response.ok && accounts.length === 1 ? accounts[0].id : null;
}

async function putObject({ token, accountId, entry, fetchImpl }) {
  const url = `${API}/accounts/${accountId}/r2/buckets/${ARCHIVE_BUCKET}/objects/${entry.key}`;
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": entry.contentType },
        body: readFileSync(entry.file),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return null;
      last = `HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      last = String(error?.message ?? error);
    }
  }
  return last;
}

export async function archiveSiteAssets({ dir, env = process.env, fetchImpl = fetch, log = console }) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    log.warn("[asset-archive] 没有 CLOUDFLARE_API_TOKEN，跳过存档");
    return { uploaded: 0, failed: [], skipped: "no-token" };
  }
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() || (await accountIdFor(token, fetchImpl));
  if (!accountId) {
    log.warn("[asset-archive] 定不下账号（CLOUDFLARE_ACCOUNT_ID 未设且令牌不止一个账号），跳过存档");
    return { uploaded: 0, failed: [], skipped: "no-account" };
  }
  const { files, skipped } = archivePlan(dir);
  if (skipped.length) log.warn(`[asset-archive] 不认识的文件不存档：${skipped.join(", ")}`);
  const failed = [];
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const entry = files[next++];
      const error = await putObject({ token, accountId, entry, fetchImpl });
      if (error) failed.push({ name: entry.name, error });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  const uploaded = files.length - failed.length;
  log.log(`[asset-archive] 已存 ${uploaded}/${files.length} 个文件到 R2 ${ARCHIVE_BUCKET}`);
  for (const { name, error } of failed) log.warn(`[asset-archive] ${name} 存档失败：${error}`);
  return { uploaded, failed, skipped: null };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.argv[2] ?? "build/client/assets";
  await archiveSiteAssets({ dir }).catch((error) => {
    console.warn(`[asset-archive] 存档中断：${String(error?.message ?? error)}`);
  });
}
