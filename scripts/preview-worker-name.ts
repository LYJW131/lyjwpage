
export const PREVIEW_WORKERS_SUBDOMAIN = "lyjw.workers.dev";
// 须与 wrangler.jsonc 里 previews_enabled 的那条自定义域名、public/_headers 的预览主机规则同步。
export const SITE_PREVIEW_DOMAIN = "preview.lyjw.dev";
export const PREVIEW_WORKER_SCRIPT = "core";
export const SITE_PREVIEW_WORKER_SCRIPT = "site";
export type PreviewWorkerScript = typeof PREVIEW_WORKER_SCRIPT | typeof SITE_PREVIEW_WORKER_SCRIPT;
export const PREVIEW_REVISION_PATH = "/api/preview/revision";
const MAX_LABEL = 63;

function slug(branch: string) {
  return branch.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function previewWorkerName(branch: string, workerName: PreviewWorkerScript = PREVIEW_WORKER_SCRIPT) {
  const name = slug(branch ?? "");
  if (!name || name === "main") return null;
  const suffix = `-${workerName}`;
  if (name.length + suffix.length <= MAX_LABEL) return name;
  const hash = shortHash(name);
  const room = MAX_LABEL - suffix.length - 1 - hash.length;
  const trimmed = name.slice(0, room).replace(/-+$/g, "");
  if (!trimmed) return null;
  return `${trimmed}-${hash}`;
}

export function previewWorkerOrigin(branch: string, workerName: PreviewWorkerScript = PREVIEW_WORKER_SCRIPT) {
  if (![PREVIEW_WORKER_SCRIPT, SITE_PREVIEW_WORKER_SCRIPT].includes(workerName)) {
    throw new Error(`Unknown Preview Worker: ${workerName}`);
  }
  const name = previewWorkerName(branch, workerName);
  if (!name) return null;
  return workerName === SITE_PREVIEW_WORKER_SCRIPT
    ? `https://${name}.${SITE_PREVIEW_DOMAIN}`
    : `https://${name}-${workerName}.${PREVIEW_WORKERS_SUBDOMAIN}`;
}
