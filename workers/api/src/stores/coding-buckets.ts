import { askStorage, tellStorage } from "@/lib/storage";
import {
  addBucketDeltas,
  CODING_BUCKET_TTL_MS,
  mergeBucketReport,
  parseStoredCodingBuckets,
  type CodingBucketDelta,
  type StoredCodingBuckets,
} from "@shared/coding-buckets";
import { codingBucketsKey } from "@shared/coding-store";
import type { CodingTokenBucketReport } from "@shared/coding-usage";
import type { CodingUsageSource } from "@shared/coding-usage-sources";

/**
 * 5 分钟 token 桶的状态核心那一半（`pulse:token-buckets:<来源>`，TTL 2 天）。合并规则在
 * shared/coding-buckets：Mac、agents 按报告范围替换，云端 OTLP 把正差值加进桶。
 * 只给 Pulse 的 Tokens 道、Jev 和 D1 归档读；不推送、不失效首屏。
 */
export type CodingBucketsLanding = { commit: () => Promise<unknown>; accepted: boolean };

const IGNORED: CodingBucketsLanding = { commit: async () => {}, accepted: false };

async function readBuckets(source: CodingUsageSource): Promise<StoredCodingBuckets | null> {
  const answered = await askStorage((storage) => storage.get(codingBucketsKey(source)));
  if (!answered.reachable) throw new Error("coding token 桶读不到");
  return parseStoredCodingBuckets(answered.value);
}

function write(source: CodingUsageSource, next: StoredCodingBuckets): CodingBucketsLanding {
  return {
    commit: () => tellStorage((storage) => storage.set(codingBucketsKey(source), JSON.stringify(next), { ttlMs: CODING_BUCKET_TTL_MS })),
    accepted: true,
  };
}

/** Mac、agents 的一封桶报告；采集时刻比存着的旧就不收 */
export async function prepareCodingBuckets(
  source: CodingUsageSource,
  report: CodingTokenBucketReport,
  receivedAt: number,
): Promise<CodingBucketsLanding> {
  const next = mergeBucketReport(await readBuckets(source), report, receivedAt);
  return next ? write(source, next) : IGNORED;
}

/** 云端 OTLP 这一封的正差值 */
export async function prepareOtlpBuckets(deltas: readonly CodingBucketDelta[], receivedAt: number): Promise<CodingBucketsLanding> {
  if (!deltas.length) return IGNORED;
  return write("agents-otlp", addBucketDeltas(await readBuckets("agents-otlp"), deltas, receivedAt));
}
