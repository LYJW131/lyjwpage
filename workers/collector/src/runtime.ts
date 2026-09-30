import type { Env } from "./env";

let bound: Env | null = null;

export function bindEnv(env: Env): Env {
  bound = env;
  return env;
}

export function currentEnv(): Env {
  if (!bound) throw new Error("采集 Worker 的 env 还没绑定：入口里先调 bindEnv");
  return bound;
}

export function unbindEnvForTests(): void {
  bound = null;
}
