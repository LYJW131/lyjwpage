export interface SiteCacheRpc {
  invalidate(tags: readonly string[]): Promise<void>;
}
