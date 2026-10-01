import type { AppleCacheKv } from "../../../src/lib/apple-cache-store";
import { currentContext } from "./runtime";

export type { AppleCacheKv };

export function appleCacheKv(): AppleCacheKv | null {
  return currentContext().env.APPLE_CACHE ?? null;
}

export function installAppleCacheForTests(): void {}
