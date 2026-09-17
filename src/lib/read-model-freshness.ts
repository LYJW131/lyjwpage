/**
 * A page that has received a live payload must not replace it with an older KV
 * projection. Keep that path authoritative for this page's lifetime. This also
 * covers Emby/PlayStation payloads that have no comparable version timestamp.
 */
const pushed = new Set<string>();
export function markLiveRead(path: string): void { pushed.add(path); }
export function authoritativeReadPath(path: string): string {
  const split = path.indexOf("?");
  const pathname = split < 0 ? path : path.slice(0, split);
  if (!pushed.has(pathname)) return path;
  const query = new URLSearchParams(split < 0 ? "" : path.slice(split + 1));
  query.set("fresh", "1");
  return `${pathname}?${query}`;
}
