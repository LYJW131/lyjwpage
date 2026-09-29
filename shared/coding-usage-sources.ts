import type { CodingUsageSource } from "@/lib/types";

export type { CodingUsageSource };

/**
 * coding agent token 用量的观测来源登记表。浏览器、Worker、单测同构，只放元数据。
 *
 * 名字 = 上报入口的来源名（AGENTS.md「入口与字段」），类型在 lib/types 的 `CodingUsageSource`：
 * 公开 payload 要用它，而那个文件不 import 任何东西。`satisfies` 保证两边一一对应，
 * 加来源 = 那边加一个名字 + 这里登记一行。
 *
 * `scope` 说明它看得到什么，合并规则只看 scope：
 * - `device`：一台机器本地日志里的会话，只看得到这台机器；
 * - `environment`：某个托管环境自报的遥测，只看得到那个环境里的会话；
 * - `account`：厂商账号侧的完整历史，这个 agent 在任何地方的用量都在里面。
 *
 * 登记顺序有意义：同一 agent 出现两个 account 级来源（配置错误）时取登记在前的那个。
 */
export type CodingUsageScope = "device" | "environment" | "account";

export const CODING_USAGE_SOURCES = {
  mac: { scope: "device", ingest: "/api/ingest/mac" },
  agents: { scope: "account", ingest: "/api/ingest/agents" },
  "agents-otlp": { scope: "environment", ingest: "/api/ingest/agents/otlp" },
} as const satisfies Record<CodingUsageSource, { scope: CodingUsageScope; ingest: string }>;

/** 全部来源，按登记顺序 */
export const CODING_USAGE_SOURCE_NAMES = Object.keys(CODING_USAGE_SOURCES) as CodingUsageSource[];

export function isCodingUsageSource(value: unknown): value is CodingUsageSource {
  return typeof value === "string" && Object.hasOwn(CODING_USAGE_SOURCES, value);
}

/**
 * 同一个 agent 在这几个来源里都有账本时，各来源的角色：
 *
 * | 来源组合 | 规则 |
 * | --- | --- |
 * | 只有一个来源 | 就用它 |
 * | 有 account 级来源 | 只用它；同 agent 的 device / environment 级来源是它的子集，标 `superseded`，不相加 |
 * | 两个以上 account 级来源 | 配置错误：取登记在前的那个，其余标 `conflict` |
 * | 只有 device / environment 级 | 全部相加：假设彼此不重叠 |
 *
 * 「相加」的前提是配置保证的：云端环境的遥测变量只配在云端。本机也开 OTLP 的话 claude 会双算，
 * 而 OTLP 没有逐条消息 id，数据层去不了重。
 *
 * 三组结果都按登记顺序排，和 `present` 的顺序无关。
 */
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

/** 参与合计的来源（`resolveCodingUsageSources` 的第一组） */
export function contributingSources(present: readonly CodingUsageSource[]): CodingUsageSource[] {
  return resolveCodingUsageSources(present).contributing;
}
