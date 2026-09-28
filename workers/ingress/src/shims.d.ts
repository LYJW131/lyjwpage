/**
 * 站点 src/lib 里按浏览器写的类型，Worker 的类型库里没有：`cache: "no-store"`。
 * 上报入口的运行时走不到那几处（prepare 只 import 了 shared/telemetry 等的类型），
 * 但 tsc 会顺着类型 import 查到 lib/apple-music。和 workers/collector/src/shims.d.ts 同一处缺口。
 */
interface RequestInit {
  cache?: string;
}
