import type { Env } from "./env";

/**
 * 当前 isolate 的绑定。src/lib 的共用模块（cache → storage-driver、apple-music →
 * 凭据与 developer token）拿不到 handler 的 `env` 参数，只能从这里取。
 *
 * 同一个部署里每次调用拿到的 env 是同一份绑定，所以一个模块级变量就够：
 * cron、RPC 和本地调试入口进来时各自先 `bindEnv`。
 */
let bound: Env | null = null;

export function bindEnv(env: Env): Env {
  bound = env;
  return env;
}

export function currentEnv(): Env {
  if (!bound) throw new Error("采集 Worker 的 env 还没绑定：入口里先调 bindEnv");
  return bound;
}

/** 测试之间清掉，别让上一个用例的替身漏进下一个 */
export function unbindEnvForTests(): void {
  bound = null;
}
