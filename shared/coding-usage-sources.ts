import type { CodingUsageSource } from "@/lib/types";

export type { CodingUsageSource };

export type CodingUsageScope = "device" | "environment" | "account";

export const CODING_USAGE_SOURCES = {
  mac: { scope: "device", ingest: "/api/ingest/mac" },
  agents: { scope: "account", ingest: "/api/ingest/agents" },
  "agents-otlp": { scope: "environment", ingest: "/api/ingest/agents/otlp" },
} as const satisfies Record<CodingUsageSource, { scope: CodingUsageScope; ingest: string }>;

export const CODING_USAGE_SOURCE_NAMES = Object.keys(CODING_USAGE_SOURCES) as CodingUsageSource[];

export function isCodingUsageSource(value: unknown): value is CodingUsageSource {
  return typeof value === "string" && Object.hasOwn(CODING_USAGE_SOURCES, value);
}

// OTLP 没有逐条消息 ID；环境遥测不得同时覆盖本机日志，否则无法去重。
export function resolveCodingUsageSources(present: readonly CodingUsageSource[]): {
  contributing: CodingUsageSource[];
  superseded: CodingUsageSource[];
  conflict: CodingUsageSource[];
} {
  const sources = CODING_USAGE_SOURCE_NAMES.filter((source) => present.includes(source));
  const account = sources.filter((source) => CODING_USAGE_SOURCES[source].scope === "account");
  if (account.length === 0) return { contributing: sources, superseded: [], conflict: [] };
  const [winner] = account;
  return {
    contributing: [winner],
    superseded: sources.filter((source) => CODING_USAGE_SOURCES[source].scope !== "account"),
    conflict: account.slice(1),
  };
}

export function contributingSources(present: readonly CodingUsageSource[]): CodingUsageSource[] {
  return resolveCodingUsageSources(present).contributing;
}
