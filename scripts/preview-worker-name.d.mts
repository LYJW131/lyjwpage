export const PREVIEW_WORKER_SCRIPTS: readonly ["api", "ai"];
export const PREVIEW_REVISION_PATH: string;
export function previewWorkerName(branch: string): string | null;
export function previewWorkerOrigin(branch: string, workerName?: "api" | "ai"): string | null;
