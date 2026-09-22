/**
 * 分支名 → 影子 api Worker 的脚本名和 workers.dev 源。
 *
 * Vercel 预览构建和 Workers Builds 非生产部署各自算一遍，必须相同。
 * 账号的 workers.dev 子域是 lyjw，生产 `api` 已经开着 workers.dev。
 * 脚本名同时是 DNS 标签，最长 63，只能是小写字母、数字和短横线。
 */

export const PREVIEW_WORKERS_SUBDOMAIN = "lyjw.workers.dev";
const PREFIX = "api-preview-";
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

/** `main` 和空分支返回 null：那不是影子 Worker。 */
export function previewWorkerName(branch) {
  const name = slug(branch ?? "");
  if (!name || name === "main") return null;
  const full = `${PREFIX}${name}`;
  if (full.length <= MAX_LABEL) return full;
  const hash = shortHash(name);
  const room = MAX_LABEL - PREFIX.length - 1 - hash.length;
  const trimmed = name.slice(0, room).replace(/-+$/g, "");
  if (!trimmed) return null;
  return `${PREFIX}${trimmed}-${hash}`;
}

export function previewWorkerOrigin(branch) {
  const name = previewWorkerName(branch);
  return name ? `https://${name}.${PREVIEW_WORKERS_SUBDOMAIN}` : null;
}
