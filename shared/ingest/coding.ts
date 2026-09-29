import {
  normalizeCodingActivityReport,
  normalizeCodingTokenBucketReport,
  normalizeCodingUsageReport,
  type CodingActivityReport,
  type CodingTokenBucketReport,
  type CodingUsageReport,
} from "@shared/coding-usage";

/**
 * Mac 信封与 `/api/ingest/agents` 共用的三份 coding 模块（契约见 shared/coding-usage）。
 *
 * 坏了**只丢这一个模块**，原因进回执的 `rejected`（上报入口并进 202 的 `data`，并记 warn）。
 * 从前任一 coding 模块坏了整封 400，连正在播放、前台应用、存活一起卡死，直到上报器换版；
 * coding 模块是从文件解析出的大块派生数据，最容易撞校验，不能让它连坐。拒绝仍然是明说的。
 */

export const CODING_MODULES = ["codingUsage", "codingActivity", "codingTokenBuckets"] as const;
export type CodingModuleName = (typeof CODING_MODULES)[number];

export type CodingModules = {
  codingUsage?: CodingUsageReport;
  codingActivity?: CodingActivityReport;
  codingTokenBuckets?: CodingTokenBucketReport;
};

/** 回执里的一条拒收：哪个模块、哪条校验没过 */
export type CodingModuleRejection = { module: CodingModuleName; error: string };

/**
 * 逐个收敛 `raw` 里出现的 coding 模块。出现就要合规：`null` 也算出现（按「必须是对象」拒掉），
 * 缺省才是没带。
 */
export function prepareCodingModules(
  raw: Record<string, unknown>,
  receivedAt: number,
): { modules: CodingModules; rejected: CodingModuleRejection[] } {
  const modules: CodingModules = {};
  const rejected: CodingModuleRejection[] = [];
  const attempt = <T>(module: CodingModuleName, parse: (input: unknown, at: number) => T): T | undefined => {
    if (!(module in raw)) return undefined;
    try {
      return parse(raw[module], receivedAt);
    } catch (error) {
      rejected.push({ module, error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  };
  const usage = attempt("codingUsage", normalizeCodingUsageReport);
  if (usage) modules.codingUsage = usage;
  const activity = attempt("codingActivity", normalizeCodingActivityReport);
  if (activity) modules.codingActivity = activity;
  const buckets = attempt("codingTokenBuckets", normalizeCodingTokenBucketReport);
  if (buckets) modules.codingTokenBuckets = buckets;
  return { modules, rejected };
}

/** 回执与日志里的一行：`codingUsage：agents[0].days[2].totalTokens 小于四列之和；…` */
export function describeRejections(rejected: readonly CodingModuleRejection[]): string {
  return rejected.map(({ module, error }) => `${module}：${error}`).join("；");
}
