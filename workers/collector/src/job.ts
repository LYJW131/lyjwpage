import type { CollectorJobName } from "@shared/collector";

import type { Env } from "./env";

/** 一次运行的上下文。`scheduled` 为假时是 RPC 或本地调试手动触发的 */
export type JobContext = {
  env: Env;
  now: number;
  scheduled: boolean;
};

/**
 * 任务正常结束的两种结果。抛错才是失败。
 *
 * `failing` 只给 PlayStation 用：这一响没跑（门或退避挡掉了），但上游已经连着坏了
 * 好几轮 —— 监控这一次要报 error，长时间断流才会开 issue。见 playstation/index.ts。
 */
export type JobResult = {
  status: "ok" | "skipped";
  detail?: string;
  failing?: string;
};

export type Job = {
  name: CollectorJobName;
  /** 每隔几分钟跑一次；必须整除 60，Sentry 监控的 crontab 才对得上 */
  everyMinutes: number;
  /** 在周期里的第几分钟跑，0 ≤ offset < everyMinutes */
  offset: number;
  /** Sentry 监控认定超时的分钟数 */
  maxRuntimeMinutes: number;
  run(ctx: JobContext): Promise<JobResult>;
};

export const ok = (detail?: string): JobResult => (detail ? { status: "ok", detail } : { status: "ok" });

const warnedMissing = new Set<string>();

/**
 * 缺令牌就干净地跳过：每个 isolate 每个任务只警告一次，监控照样报 ok ——
 * 没配令牌是配置状态，不是故障。
 */
export function skipMissing(job: CollectorJobName, missing: string[]): JobResult {
  if (!warnedMissing.has(job)) {
    warnedMissing.add(job);
    console.warn(JSON.stringify({ event: "collector-skip", job, missing }));
  }
  return { status: "skipped", detail: `missing ${missing.join(", ")}` };
}

export function resetSkipWarningsForTests(): void {
  warnedMissing.clear();
}

/** 取一个字符串变量或 secret；空白当没有 */
export function setting(env: Env, name: keyof Env): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 一组必需的设置，缺哪个列哪个 */
export function settings<const K extends keyof Env>(env: Env, names: readonly K[]): { values: Record<K, string> } | { missing: K[] } {
  const values = {} as Record<K, string>;
  const missing: K[] = [];
  for (const name of names) {
    const value = setting(env, name);
    if (value) values[name] = value;
    else missing.push(name);
  }
  return missing.length ? { missing } : { values };
}

export function explain(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
