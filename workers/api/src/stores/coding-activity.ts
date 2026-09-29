import type { LiveEvent } from "@/lib/live-events";
import { readLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import { askStorage, tellStorage } from "@/lib/storage";
import { codingActivityKey, parseStoredActivity, type StoredCodingActivity } from "@shared/coding-store";
import type { CodingActivityReport } from "@shared/coding-usage";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { buildCodingNowAgents } from "@shared/coding-usage-view";

/**
 * 活动事实（各 agent 最近一条用量事件）的状态核心那一半：`coding:activity:<来源>` 整份替换，
 * 拼好整份 `/api/status/coding/now` 推 `coding-now`。
 *
 * 只在浏览器看得出区别时推：多出一个 (agent, 来源)、换了模型、时刻往前走了大半分钟。
 * 灯按 5 分钟窗口现算，推送只是让它立刻亮；各来源一分钟上下一封，时刻差在 60 秒上下抖，
 * 门槛留点余量。内容不变的保活（Mac 至少 5 分钟一封）只续采集时刻，不推。
 * 存活的变化走 `presence` 事件，这里不为它推。
 */
export type CodingActivities = Partial<Record<CodingUsageSource, StoredCodingActivity>>;

const PUSH_STEP_MS = 45_000;

export async function readCodingActivities(): Promise<CodingActivities> {
  const answered = await askStorage(async (storage) => {
    const batch = storage.batch();
    for (const source of CODING_USAGE_SOURCE_NAMES) batch.get(codingActivityKey(source));
    return batch.execute();
  });
  const activities: CodingActivities = {};
  if (!answered.reachable) return activities;
  CODING_USAGE_SOURCE_NAMES.forEach((source, index) => {
    const stored = parseStoredActivity(answered.value[index]);
    if (stored) activities[source] = stored;
  });
  return activities;
}

function worthPushing(before: CodingActivities, after: CodingActivities): boolean {
  const entries = (activities: CodingActivities) => new Map(buildCodingNowAgents(activities)
    .flatMap((agent) => agent.activity.map((entry) => [`${agent.id}\u001f${entry.source}`, entry] as const)));
  const previous = entries(before);
  const next = entries(after);
  if (previous.size !== next.size) return true;
  for (const [id, entry] of next) {
    const old = previous.get(id);
    if (!old || old.model !== entry.model || entry.lastActivityAt - old.lastActivityAt >= PUSH_STEP_MS) return true;
  }
  return false;
}

export type CodingActivityLanding = {
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
  const activities = await readCodingActivities();
  const previous = activities[source] ?? null;
  if (previous && report.collectedAt < previous.collectedAt) {
    return { commit: async () => {}, event: null, previous, accepted: false };
  }
  const next: StoredCodingActivity = { ...report, receivedAt };
  const after = { ...activities, [source]: next };
  const event: LiveEvent | null = worthPushing(activities, after)
    ? { type: "coding-now", payload: withPresence({ agents: buildCodingNowAgents(after) }, liveness ?? await readLiveness()) }
    : null;
  return {
    commit: () => tellStorage((storage) => storage.set(codingActivityKey(source), JSON.stringify(next))),
    event,
    previous,
    accepted: true,
  };
}
