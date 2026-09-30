import type { CollectorJobName } from "@shared/collector";

import type { Env } from "./env";

export type JobContext = {
  env: Env;
  now: number;
  scheduled: boolean;
};

export type JobResult = {
  status: "ok" | "skipped";
  detail?: string;
  failing?: string;
};

export type Job = {
  name: CollectorJobName;
  everyMinutes: number;
  offset: number;
  maxRuntimeMinutes: number;
  // Worker 同时等待响应头的连接数有限，短超时任务需先启动，避免预算耗在排队上。
  headStart?: boolean;
  run(ctx: JobContext): Promise<JobResult>;
};

export const ok = (detail?: string): JobResult => (detail ? { status: "ok", detail } : { status: "ok" });

const warnedMissing = new Set<string>();

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

export function setting(env: Env, name: keyof Env): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

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
