export const PREVIEW_WORKER_SCRIPT: "core";
export const SITE_PREVIEW_WORKER_SCRIPT: "site";
export const PREVIEW_REVISION_PATH: string;
export function previewWorkerName(branch: string, workerName?: "core" | "site"): string | null;
export function previewWorkerOrigin(branch: string, workerName?: "core" | "site"): string | null;
