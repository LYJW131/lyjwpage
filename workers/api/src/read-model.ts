/** Only public, replayable views belong here. No credentials, locks or raw store keys. */
export type ReadModelPolicy = { intervalMs: number; maxAgeMs: number };
const minute = 60_000;
const recent: ReadModelPolicy = { intervalMs: minute, maxAgeMs: 3 * minute };
const slow: ReadModelPolicy = { intervalMs: 5 * minute, maxAgeMs: 10 * minute };

const policies: Readonly<Record<string, ReadModelPolicy>> = {
  // Browser mount bootstrap: the first round of every card is one KV read of this.
  // SSR rebuilds ask with fresh=1 and never see the projection; later polls hit their own paths.
  "/api/home": recent,
  "/api/status/listening": recent,
  "/api/status/watching": recent,
  "/api/status/playing": recent,
  "/api/status/trophies": slow,
  "/api/status/vibecoding/year": slow,
  "/api/status/github-chart": slow,
  "/api/status/github-repo": slow,
  "/api/status/cloudflare-workers": slow,
  "/api/status/vercel-deployments": slow,
  // 分最快十分钟一换，泳道本身也只到分钟尺度。
  "/api/status/pulse": slow,
};
export const READ_MODEL_PATHS = Object.freeze(Object.keys(policies));
export function readModelPolicy(path: string): ReadModelPolicy | undefined {
  return Object.hasOwn(policies, path) ? policies[path] : undefined;
}
export function readModelKey(prefix: string, path: string): string {
  return `${prefix}:public-read-model:v1:${path}`;
}
export function readModelPathsForSource(source: string): string[] {
  switch (source) {
    case "mac": return ["/api/home", "/api/status/vibecoding/year"];
    case "emby": return ["/api/home", "/api/status/watching"];
    case "playstation": return ["/api/home", "/api/status/playing", "/api/status/trophies"];
    case "iphone": case "homepod": case "server": case "agents": return ["/api/home"];
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
export function isPublicBody(path: string, body: string): boolean {
  if (body.length > MAX_BODY_BYTES || new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return false;
  try {
    const value: unknown = JSON.parse(body);
    if (!record(value)) return false;
    // Aggregate home has per-card envelopes, not a top-level ok flag.
    if (path === "/api/home") return ["desktop", "nowListening", "charger", "timezone"].every((key) =>
      record(value[key]) && typeof value[key].ok === "boolean");
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
    typeof value.body === "string" && isPublicBody(path, value.body);
}
