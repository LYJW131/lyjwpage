/**
 * A page that has received a live payload must not replace it with an older KV
 * projection. Keep that path authoritative for this page's lifetime. This also
 * covers Emby/PlayStation payloads that have no comparable version timestamp.
 */
const kvPushPaths = new Set([
  "/api/status/listening", "/api/status/watching", "/api/status/playing",
]);
const pushed = new Set<string>();
/** 收到过推送或失效通知的全部路径，不限于走 KV 的那三条 */
const live = new Set<string>();
export function markLiveRead(path: string): void {
  live.add(path);
  if (kvPushPaths.has(path)) pushed.add(path);
}
/**
 * 本页已经收到过该路径的推送；聚合引导（lib/home-bootstrap）不能再代答它。
 * 覆盖所有推送路径：`watching/now`、`charger` 这些既不走 KV 也没有时间戳可比，
 * 一份最多三分钟旧的聚合若在推送之后才到，会把推来的盖回去。
 */
export function hasLiveRead(path: string): boolean {
  return live.has(path);
}
export function authoritativeReadPath(path: string): string {
  const split = path.indexOf("?");
  const pathname = split < 0 ? path : path.slice(0, split);
  if (!pushed.has(pathname)) return path;
  const query = new URLSearchParams(split < 0 ? "" : path.slice(split + 1));
  query.set("fresh", "1");
  return `${pathname}?${query}`;
}
