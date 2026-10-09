
export const PREVIEW_WORKERS_SUBDOMAIN = "lyjw.workers.dev";
export const PREVIEW_WORKER_SCRIPT = "api";
export const PREVIEW_WORKER_SCRIPTS = ["api", "ai"];
export const PREVIEW_REVISION_PATH = "/api/preview/revision";
const MAX_LABEL = 63;

function slug(branch) {
  return branch.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

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

export function previewWorkerOrigin(branch, workerName = PREVIEW_WORKER_SCRIPT) {
  if (!PREVIEW_WORKER_SCRIPTS.includes(workerName)) throw new Error(`Unknown Preview Worker: ${workerName}`);
  const name = previewWorkerName(branch);
  return name
    ? `https://${name}-${workerName}.${PREVIEW_WORKERS_SUBDOMAIN}`
    : null;
}
