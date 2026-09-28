/**
 * 站点 src/lib 里按浏览器写的类型，Worker 的类型库里没有：`cache: "no-store"`
 * （lib/apple-music 的 fetch 带着它，Workers 的 fetch 认）。和 workers/api/src/shims.d.ts 同一处缺口。
 */
interface RequestInit {
  cache?: string;
}
