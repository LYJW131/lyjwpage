/**
 * 分支名 → Worker Preview 的名字和 workers.dev 源。
 *
 * `wrangler preview --name` 用这个名字。地址形状是 Cloudflare 文档里的
 * `<preview-name>-<worker>.<subdomain>.workers.dev`，worker 名是生产脚本 `api`。
 * Vercel 预览构建和部署脚本各算一遍，必须相同。
 * 整段主机名标签最长 63。
 */

export const PREVIEW_WORKERS_SUBDOMAIN = "lyjw.workers.dev";
export const PREVIEW_WORKER_SCRIPT = "api";
const MAX_LABEL = 63;

function slug(branch) {
  return branch.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** 8 位十六进制，长分支截断后仍和另一条长分支错开。 */
function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** `main` 和空分支返回 null：那不是 Preview。 */
export function previewWorkerName(branch) {
  const name = slug(branch ?? "");
  if (!name || name === "main") return null;
  const suffix = `-${PREVIEW_WORKER_SCRIPT}`;
  if (name.length + suffix.length <= MAX_LABEL) return name;
  const hash = shortHash(name);
  const room = MAX_LABEL - suffix.length - 1 - hash.length;
  const trimmed = name.slice(0, room).replace(/-+$/g, "");
  if (!trimmed) return null;
  return `${trimmed}-${hash}`;
}

export function previewWorkerOrigin(branch) {
  const name = previewWorkerName(branch);
  return name
    ? `https://${name}-${PREVIEW_WORKER_SCRIPT}.${PREVIEW_WORKERS_SUBDOMAIN}`
    : null;
}
