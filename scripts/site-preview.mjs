import { previewWorkerName, previewWorkerOrigin, PREVIEW_WORKER_SCRIPTS, SITE_PREVIEW_WORKER_SCRIPT } from "./preview-worker-name.mjs";

export const SITE_PREVIEW_MANIFEST_PATH = "build/site-preview.json";
export const SITE_PREVIEW_ACCESS_VAR = "SITE_PREVIEW_ACCESS_READY";

const BUILT_CONFIG_KEYS = [
  "name", "main", "assets", "rules", "no_bundle",
  "compatibility_date", "compatibility_flags", "cache", "exports", "images",
];

export function sitePreviewManifest({ branch = "", commit, backendUrl = null }) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? "")) {
    throw new Error(`site preview manifest commit must be a 40-char lowercase SHA: ${JSON.stringify(commit)}`);
  }
  const trimmed = (branch ?? "").trim();
  if (!trimmed || trimmed === "main") {
    if (backendUrl != null) throw new Error("a production build cannot pin a preview backend");
    return { version: 1, mode: "production", branch: trimmed || "main", commit, backendUrl: null };
  }
  if (!previewWorkerName(trimmed, SITE_PREVIEW_WORKER_SCRIPT)) {
    throw new Error(`invalid preview branch: ${JSON.stringify(trimmed)}`);
  }
  const allowed = new Set(PREVIEW_WORKER_SCRIPTS.map((worker) => previewWorkerOrigin(trimmed, worker)));
  if (!allowed.has(backendUrl)) {
    throw new Error("the preview backend must be this branch's api or ai Preview origin");
  }
  return { version: 1, mode: "preview", branch: trimmed, commit, backendUrl };
}

export function sitePreviewDeployEnv(env = process.env) {
  const branch = env.WORKERS_CI_BRANCH?.trim() ?? "";
  const commit = env.WORKERS_CI_COMMIT_SHA?.trim() ?? "";
  return { branch, commit, accessReady: env[SITE_PREVIEW_ACCESS_VAR]?.trim() === "true" };
}

export function sitePreviewVars(manifest) {
  return {
    SITE_ENV: "preview",
    PUBLIC_BACKEND_URL: manifest.backendUrl,
    R2_PUBLIC_BASE_URL: "https://lyjw.me/img",
    SENTRY_ENVIRONMENT: "preview",
  };
}

export function sitePreviewConfig(built, manifest) {
  const config = {};
  for (const key of BUILT_CONFIG_KEYS) {
    if (built[key] !== undefined) config[key] = built[key];
  }
  const vars = sitePreviewVars(manifest);
  const empty = { services: [], r2_buckets: [], kv_namespaces: [], d1_databases: [], durable_objects: { bindings: [] }, images: { binding: "IMAGES" } };
  Object.assign(config, empty, { workers_dev: false, vars });
  config.previews = { vars, ...empty };
  return config;
}

export function sitePreviewName(manifest) {
  const name = previewWorkerName(manifest.branch, SITE_PREVIEW_WORKER_SCRIPT);
  if (!name) throw new Error(`branch ${JSON.stringify(manifest.branch)} has no Preview`);
  return name;
}
