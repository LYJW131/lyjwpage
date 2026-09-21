export const DEV_OVERRIDE_PREFIX = "/api/dev/override";
export const DEV_OVERRIDES_LIST_PATH = "/api/dev/overrides";
export const DEV_OVERRIDE_KEY = "dev-override:";
export const DEV_OVERRIDE_INDEX_KEY = "dev-override-index";
export const DEV_OVERRIDE_ENABLED_KEY = "dev-override-enabled";
export const DEV_OVERRIDE_TTL_MS = 7 * 86_400_000;

export function overrideStorageKey(prefix: string, path: string): string {
  return `${prefix}:cache:${DEV_OVERRIDE_KEY}${path}`;
}

export function overrideIndexStorageKey(prefix: string): string {
  return `${prefix}:cache:${DEV_OVERRIDE_INDEX_KEY}`;
}
