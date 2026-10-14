#!/usr/bin/env node
import { purgeEsaHomepage, warmupEsaCache } from "./esa-purge.mjs";

const siteId = process.env.ESA_SITE_ID || "1113300533463584";
const cacheUrl = process.env.ESA_CACHE_URL || "https://lyjw131.com/";
const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

console.log(`[esa-purge] 准备刷新 ESA 首页缓存: ${cacheUrl} (SiteId: ${siteId})`);

if (!accessKeyId || !accessKeySecret) {
  console.error("[esa-purge] 错误：未设置 ALIYUN_ACCESS_KEY_ID 或 ALIYUN_ACCESS_KEY_SECRET 环境变量。");
  process.exit(1);
}

const result = await purgeEsaHomepage({
  siteId,
  cacheUrl,
  accessKeyId,
  accessKeySecret,
});

if (!result.ok) {
  console.error(`[esa-purge] 刷新失败: ${result.error}`);
  process.exit(1);
}

console.log(`[esa-purge] 刷新任务已成功提交！TaskId: ${result.taskId}, RequestId: ${result.requestId}`);

console.log(`[esa-purge] 正在预热缓存: GET ${cacheUrl}...`);
const warmup = await warmupEsaCache(cacheUrl);
if (warmup.ok) {
  console.log(`[esa-purge] 预热请求成功 (HTTP ${warmup.status})，边缘节点已回源并写入首屏缓存。`);
} else {
  console.warn(`[esa-purge] 预热请求未成功完成: ${warmup.error ?? `HTTP ${warmup.status}`} (刷新任务已在运行，不阻断部署)`);
}
