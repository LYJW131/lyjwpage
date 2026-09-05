/** 首屏可以先展示旧值；API 的 urgent 更新必须在下一次读取时生效。 */
export type StatusCacheScope = "page" | "api";

/** scope 同时进入 use cache 的参数和标签，避免两种读取互相失效。 */
export function statusCacheTag(scope: StatusCacheScope, tag: string): string {
  return `${scope}:${tag}`;
}
