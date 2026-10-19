import { getStorage } from "@shared/storage";
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
  const values = await getStorage().batch().get(codingBucketsKey(source)).get(codingBucketsRevisionKey()).execute();
  return { stored: parseStoredCodingBuckets(values[0]), revision: parseRevision(values[1]) + 1 };
}

function write(source: CodingUsageSource, next: StoredCodingBuckets, revision: number): CodingBucketsLanding {
  const stage = (batch: StorageBatch) => {
    batch
      .set(codingBucketsKey(source), JSON.stringify({ ...next, revision }), { ttlMs: CODING_BUCKET_TTL_MS })
      .set(codingBucketsRevisionKey(), String(revision));
  };
  return {
    stage,
    commit: () => {
      const batch = getStorage().batch();
      stage(batch);
      return batch.execute();
    },
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

// agent 换了来源时，旧来源里它的桶一起删掉，否则 Tokens 道会把两边相加。
export async function prepareBucketsWithout(source: CodingUsageSource, ids: readonly string[]): Promise<CodingBucketsLanding> {
  const { stored, revision } = await readBuckets(source);
  const drop = new Set(ids);
  if (!stored || !stored.windows.some((window) => window.agents.some((row) => drop.has(row.id)))
    && !stored.agents.some((agent) => drop.has(agent.id))) return IGNORED;
  return write(source, {
    ...stored,
    agents: stored.agents.filter((agent) => !drop.has(agent.id)),
    windows: stored.windows
      .map((window) => ({ ...window, agents: window.agents.filter((row) => !drop.has(row.id)) }))
      .filter((window) => window.agents.length > 0),
  }, revision);
}
