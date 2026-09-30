export const CODING_BUCKET_MS = 300_000;

export const MAX_DAY_MODELS = 64;
export const MAX_WINDOW_ROWS = 64;

export const OVERFLOW_MODEL = "unknown";

export function bucketStart(ms: number): number {
  return Math.floor(ms / CODING_BUCKET_MS) * CODING_BUCKET_MS;
}

export type CodingUsageDay = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  costComplete: boolean;
  models: Array<{ model: string; tokens: number }>;
};

export type CodingUsageAgent = {
  id: string;
  state: "ok" | "error";
  collectedAt: number | null;
  error: string | null;
  warning: string | null;
  sessionCount: number | null;
  days?: CodingUsageDay[];
};

export type CodingUsageReport = { agents: CodingUsageAgent[] };

export type CodingActivityReport = {
  collectedAt: number;
  agents: Array<{ id: string; lastActivityAt: number | null; model: string | null }>;
};

export type CodingTokenBucketState = "ok" | "partial" | "unavailable";

export type CodingTokenBucketRow = {
  id: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  eventCount: number | null;
};

export type CodingTokenBucketWindow = { from: number; agents: CodingTokenBucketRow[] };

export type CodingTokenBucketReport = {
  from: number;
  to: number;
  collectedAt: number;
  agents: Array<{ id: string; state: CodingTokenBucketState }>;
  windows: CodingTokenBucketWindow[];
};
