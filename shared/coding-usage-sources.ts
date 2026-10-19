import type { CodingUsageSource } from "@shared/types";

export type { CodingUsageSource };

export type CodingUsageScope = "device" | "environment" | "account";

export const CODING_USAGE_SOURCES = {
  mac: { scope: "device", ingest: "/api/ingest/mac", otlp: false },
  agents: { scope: "account", ingest: "/api/ingest/agents", otlp: false },
  "agents-otlp": { scope: "environment", ingest: "/api/ingest/agents/otlp", otlp: true },
  // 同一个 OTLP 入口，由 ingress 按验过的 Access 凭据（lyjwpage-mac）分到这里：Mac 上 agent 自带遥测推来的用量。
  "mac-otlp": { scope: "device", ingest: "/api/ingest/agents/otlp", otlp: true },
} as const satisfies Record<CodingUsageSource, { scope: CodingUsageScope; ingest: string; otlp: boolean }>;

export type OtlpCodingSource = { [K in CodingUsageSource]: (typeof CODING_USAGE_SOURCES)[K]["otlp"] extends true ? K : never }[CodingUsageSource];

export const CODING_USAGE_SOURCE_NAMES = Object.keys(CODING_USAGE_SOURCES) as CodingUsageSource[];

// OTLP 来源没有扫描覆盖区间，只有收到的时刻。
export function isOtlpCodingSource(source: CodingUsageSource): source is OtlpCodingSource {
  return CODING_USAGE_SOURCES[source].otlp;
}

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
