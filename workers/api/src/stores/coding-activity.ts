import type { LiveEvent } from "@/lib/live-events";
import { readLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import { askStorage, tellStorage } from "@/lib/storage";
import type { CodingNowPayload } from "@/lib/types";
import { codingActivityKey, codingPushedNowKey, parseStoredActivity, parseStoredPushedNow, type StoredCodingActivity } from "@shared/coding-store";
import type { CodingActivityReport } from "@shared/coding-usage";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { buildCodingNowAgents } from "@shared/coding-usage-view";
import type { StorageBatch } from "@shared/storage-client";

/**
 * 活动事实（各 agent 最近一条用量事件）的状态核心那一半：`coding:activity:<来源>` 整份替换，
 * 拼好整份 `/api/status/coding/now` 推 `coding-now`。
 *
 * 只在浏览器看得出区别时推：比起**上一次推出去的那份**（`coding:now:pushed`），多出一个
 * (agent, 来源)、换了模型、时刻往前走了大半分钟。灯按 5 分钟窗口现算，推送只是让它立刻亮；
 * 各来源一分钟上下一封，时刻差在 60 秒上下抖，门槛留点余量。拿上一封存下的报告比会漏推：
 * 每 30 秒一封、每封只往前走 30 秒，永远跨不过门槛。内容不变的保活（Mac 至少 5 分钟一封）
 * 只续采集时刻，不推。存活的变化走 `presence` 事件，这里不为它推。
 */
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
  /** 把这封的写入排进调用方的那一批（云端 OTLP 那条路和计数器同一个事务） */
  stage: (batch: StorageBatch) => void;
  commit: () => Promise<unknown>;
  event: LiveEvent | null;
  /** 收下之前存着的那份（Cursor 观测要比时刻有没有往前走） */
  previous: StoredCodingActivity | null;
  /** 采集时刻比存着的旧（重发、乱序）就不收 */
  accepted: boolean;
};

/**
 * `liveness` 是 Mac 那封上报刚算出来的存活；别的来源不带，读存着的那份。
 */
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
    // 推送基准和这封一起落：推了就是这一份，没推就留着上一次推的
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
