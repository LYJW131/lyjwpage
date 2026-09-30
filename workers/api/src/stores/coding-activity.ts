import type { LiveEvent } from "@/lib/live-events";
import { readLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import { askStorage, tellStorage } from "@/lib/storage";
import type { CodingNowPayload } from "@/lib/types";
import { codingActivityKey, codingPushedNowKey, parseStoredActivity, parseStoredPushedNow, type StoredCodingActivity } from "@shared/coding-store";
import type { CodingActivityReport } from "@shared/coding-usage";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { buildCodingNowAgents } from "@shared/coding-usage-view";
import type { StorageBatch } from "@shared/storage-client";

// 推送阈值要和上次已推值比较，逐封比较会让连续小增量永远达不到门槛。
export type CodingActivities = Partial<Record<CodingUsageSource, StoredCodingActivity>>;

const PUSH_STEP_MS = 45_000;

function activitiesOf(values: readonly unknown[]): CodingActivities {
  const activities: CodingActivities = {};
  CODING_USAGE_SOURCE_NAMES.forEach((source, index) => {
    const stored = parseStoredActivity(values[index]);
    if (stored) activities[source] = stored;
  });
  return activities;
}

export async function readCodingActivities(): Promise<CodingActivities> {
  const answered = await askStorage(async (storage) => {
    const batch = storage.batch();
    for (const source of CODING_USAGE_SOURCE_NAMES) batch.get(codingActivityKey(source));
    return batch.execute();
  });
  return answered.reachable ? activitiesOf(answered.value) : {};
}

function worthPushing(pushed: CodingNowPayload["agents"], next: CodingNowPayload["agents"]): boolean {
  const entries = (agents: CodingNowPayload["agents"]) => new Map(agents
    .flatMap((agent) => agent.activity.map((entry) => [`${agent.id}\u001f${entry.source}`, entry] as const)));
  const previous = entries(pushed);
  const current = entries(next);
  if (previous.size !== current.size) return true;
  for (const [id, entry] of current) {
    const old = previous.get(id);
    if (!old || old.model !== entry.model || entry.lastActivityAt - old.lastActivityAt >= PUSH_STEP_MS) return true;
  }
  return false;
}

export type CodingActivityLanding = {
  stage: (batch: StorageBatch) => void;
  commit: () => Promise<unknown>;
  event: LiveEvent | null;
  previous: StoredCodingActivity | null;
  accepted: boolean;
};

export async function prepareCodingActivity(
  source: CodingUsageSource,
  report: CodingActivityReport,
  receivedAt: number,
  liveness?: Liveness,
): Promise<CodingActivityLanding> {
  const answered = await askStorage(async (storage) => {
    const batch = storage.batch();
    for (const name of CODING_USAGE_SOURCE_NAMES) batch.get(codingActivityKey(name));
    batch.get(codingPushedNowKey());
    return batch.execute();
  });
  const activities = answered.reachable ? activitiesOf(answered.value) : {};
  const pushed = answered.reachable ? parseStoredPushedNow(answered.value[CODING_USAGE_SOURCE_NAMES.length]) : [];
  const previous = activities[source] ?? null;
  if (previous && report.collectedAt < previous.collectedAt) {
    return { stage: () => {}, commit: async () => {}, event: null, previous, accepted: false };
  }
  const next: StoredCodingActivity = { ...report, receivedAt };
  const agents = buildCodingNowAgents({ ...activities, [source]: next });
  const push = worthPushing(pushed, agents);
  const event: LiveEvent | null = push
    ? { type: "coding-now", payload: withPresence({ agents }, liveness ?? await readLiveness()) }
    : null;
  const stage = (batch: StorageBatch) => {
    batch.set(codingActivityKey(source), JSON.stringify(next));
    if (push) batch.set(codingPushedNowKey(), JSON.stringify(agents));
  };
  return {
    stage,
    commit: () => tellStorage((storage) => {
      const batch = storage.batch();
      stage(batch);
      return batch.execute();
    }),
    event,
    previous,
    accepted: true,
  };
}
