import {
  normalizeCodingActivityReport,
  normalizeCodingTokenBucketReport,
  normalizeCodingUsageReport,
  type CodingActivityReport,
  type CodingTokenBucketReport,
  type CodingUsageReport,
} from "@shared/coding-usage";

// coding 模块独立拒收，避免日志解析故障阻断同封的播放状态与存活上报。

export const CODING_MODULES = ["codingUsage", "codingActivity", "codingTokenBuckets"] as const;
export type CodingModuleName = (typeof CODING_MODULES)[number];

export type CodingModules = {
  codingUsage?: CodingUsageReport;
  codingActivity?: CodingActivityReport;
  codingTokenBuckets?: CodingTokenBucketReport;
};

export type CodingModuleRejection = { module: CodingModuleName; error: string };

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

export function describeRejections(rejected: readonly CodingModuleRejection[]): string {
  return rejected.map(({ module, error }) => `${module}：${error}`).join("；");
}
