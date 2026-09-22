#!/usr/bin/env node
/**
 * PR 关闭时删掉对应影子 Worker。没有令牌或脚本本来就不存在时成功退出，
 * 不把「还没配清理令牌」报成检查失败。
 *
 * 走 REST 而不是 wrangler delete：wrangler 删除前会查 KV 命名空间，而清理
 * 令牌按最小权限只给 Workers Scripts 编辑，那一步必吃 10000 认证错误把任务
 * 打红 —— 影子本来就不挂 KV。
 */
import { previewWorkerName } from "../../../scripts/preview-worker-name.mjs";

const branch = (process.env.PREVIEW_BRANCH ?? process.env.WORKERS_CI_BRANCH ?? "").trim();
const name = previewWorkerName(branch);
if (!name) {
  console.log(`[preview] 分支 ${JSON.stringify(branch)} 没有影子 Worker`);
  process.exit(0);
}
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
if (!token || !account) {
  console.log("[preview] 未配置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，留下影子 Worker");
  process.exit(0);
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${encodeURIComponent(name)}`,
  { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
);
if (response.ok) {
  console.log(`[preview] ${name} 已删除`);
  process.exit(0);
}
if (response.status === 404 || response.status === 10007) {
  console.log(`[preview] ${name} 不存在，跳过`);
  process.exit(0);
}
console.log(`[preview] 删除 ${name} 失败：HTTP ${response.status}`);
process.exit(1);
