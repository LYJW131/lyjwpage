import { READ_MODEL_PATHS as VIEW_READ_MODEL_PATHS, readModelPolicyOf } from "@/lib/status-views";

/** Only public, replayable views belong here. No credentials, locks or raw store keys. */
export type ReadModelPolicy = { intervalMs: number; maxAgeMs: number };
const slow: ReadModelPolicy = { intervalMs: 300_000, maxAgeMs: 600_000 };

export const READ_MODEL_PATHS = VIEW_READ_MODEL_PATHS;
export function readModelPolicy(path: string): ReadModelPolicy | undefined {
  return readModelPolicyOf(path) === "slow" ? slow : undefined;
}
export function readModelKey(prefix: string, path: string): string {
  return `${prefix}:public-read-model:v1:${path}`;
}
export function readModelPathsForSource(source: string): string[] {
  switch (source) {
    // /api/home is deliberately absent: both the SSR rebuild and the browser's mount
    // bootstrap read it from the DO, so a projection would have no reader.
    case "mac": return ["/api/status/vibecoding/year"];
    default: return [];
  }
}

/** Structural subset of KVNamespace, also usable by deterministic tests. */
export interface ReadModelKv {
  get(key: string, options: { type: "json"; cacheTtl: number }): Promise<unknown>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}
export type PublicReadModel = {
  schema: 1;
  path: string;
  revision: number;
  generatedAt: number;
  body: string;
};
const MAX_BODY_BYTES = 1024 * 1024;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isPublicBody(body: string): boolean {
  if (body.length > MAX_BODY_BYTES || new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return false;
  try {
    const value: unknown = JSON.parse(body);
    if (!record(value)) return false;
    return value.ok === true && Object.hasOwn(value, "data");
  } catch { return false; }
}
export function usableReadModel(value: unknown, path: string, now: number): value is PublicReadModel {
  const policy = readModelPolicy(path);
  if (!policy || !record(value)) return false;
  return value.schema === 1 && value.path === path &&
    typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    typeof value.generatedAt === "number" && Number.isSafeInteger(value.generatedAt) &&
    value.generatedAt <= now && now - value.generatedAt < policy.maxAgeMs &&
    typeof value.body === "string" && isPublicBody(value.body);
}
