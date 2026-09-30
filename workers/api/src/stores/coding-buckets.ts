import { askStorage, tellStorage } from "@/lib/storage";
import {
  addBucketDeltas,
  CODING_BUCKET_TTL_MS,
  mergeBucketReport,
  parseStoredCodingBuckets,
  type CodingBucketDelta,
  type StoredCodingBuckets,
} from "@shared/coding-buckets";
import { codingBucketsKey, codingBucketsRevisionKey, parseRevision } from "@shared/coding-store";
import type { CodingTokenBucketReport } from "@shared/coding-usage";
import type { CodingUsageSource } from "@shared/coding-usage-sources";
import type { StorageBatch } from "@shared/storage-client";

export type CodingBucketsLanding = {
  stage: (batch: StorageBatch) => void;
  commit: () => Promise<unknown>;
  accepted: boolean;
};

const IGNORED: CodingBucketsLanding = { stage: () => {}, commit: async () => {}, accepted: false };

async function readBuckets(source: CodingUsageSource): Promise<{ stored: StoredCodingBuckets | null; revision: number }> {
  const answered = await askStorage((storage) => storage.batch().get(codingBucketsKey(source)).get(codingBucketsRevisionKey()).execute());
  if (!answered.reachable) throw new Error("coding token 桶读不到");
  return { stored: parseStoredCodingBuckets(answered.value[0]), revision: parseRevision(answered.value[1]) + 1 };
}

function write(source: CodingUsageSource, next: StoredCodingBuckets, revision: number): CodingBucketsLanding {
  const stage = (batch: StorageBatch) => {
    batch
      .set(codingBucketsKey(source), JSON.stringify({ ...next, revision }), { ttlMs: CODING_BUCKET_TTL_MS })
      .set(codingBucketsRevisionKey(), String(revision));
  };
  return {
    stage,
    commit: () => tellStorage((storage) => {
      const batch = storage.batch();
      stage(batch);
      return batch.execute();
    }),
    accepted: true,
  };
}

export async function prepareCodingBuckets(
  source: CodingUsageSource,
  report: CodingTokenBucketReport,
  receivedAt: number,
): Promise<CodingBucketsLanding> {
  const { stored, revision } = await readBuckets(source);
  const next = mergeBucketReport(stored, report, receivedAt);
  return next ? write(source, next, revision) : IGNORED;
}

export async function prepareOtlpBuckets(deltas: readonly CodingBucketDelta[], receivedAt: number): Promise<CodingBucketsLanding> {
  if (!deltas.length) return IGNORED;
  const { stored, revision } = await readBuckets("agents-otlp");
  return write("agents-otlp", addBucketDeltas(stored, deltas, receivedAt), revision);
}
