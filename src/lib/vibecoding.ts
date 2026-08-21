import { mirrorKey } from "@/lib/redis";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import type {
  VibeCodingAgent,
  VibeCodingNowPayload,
  VibeCodingPayload,
} from "@/lib/types";
import {
  normalizeVibeCodingNow,
  normalizeVibeCodingUsage,
  type ParsedVibeCodingNow,
  type ParsedVibeCodingUsage,
} from "@/lib/vibecoding-parse";

/**
 * 两个模块两份存储，按**多久变一次**分。
 *
 * - `now`：此刻在不在用、用的是哪个模型。60 秒一轮，变了就推给浏览器。
 * - `usage`：token、费用、套餐、限额、会话总数 —— 全是累计事实，
 *   十几分钟才动一次，只失效首屏缓存，不推送。
 *
 * 从前是三份：用量、限额、会话状态各一个模块。那条分界线是按「哪条命令产出的」
 * 划的 —— 当年限额和用量来自 CodexBar 的两条命令，其中那条十几秒的扫描一失败，
 * 同一轮刚取到的限额也跟着发不出去，拆开才有意义。如今三份都来自 TokenTracker
 * 同一个本地服务、跟着同两个间隔转，采集失败也是一起失败，那道线就只剩历史了。
 *
 * 留下的这一道是真实存在的：一份是「此刻」，一份是「至今累计」。
 *
 * Redis 为主、进程内存为辅，规则见 lib/redis 的 mirrorKey。
 */
const usageMirror = mirrorKey<{ payload: StoredUsage; pushedAt: number }>(
  ["vibecoding", "usage"],
  (state) => state.pushedAt,
);
const nowMirror = mirrorKey<{ payload: StoredNow; pushedAt: number }>(
  ["vibecoding", "now"],
  (state) => state.pushedAt,
);

/** 长间隔那份：一次采集里所有的累计量。展示名和图标跟着行走，读的时候原样取出。 */
type StoredUsage = ParsedVibeCodingUsage;

/** 短间隔那份：此刻的状态，没有任何累计量。 */
type StoredNow = ParsedVibeCodingNow;

/**
 * 两个模块一律「先校验，后落库」，写留给 commit。
 *
 * 校验是同步的，所以整条信封的校验全部排在任何一次写之前 —— 后面一份写坏时，
 * 前面那份根本还没落库，不会留下半截状态。而且写不再挡着推送，见 lib/live-events
 * 的 fanout。
 */
export function prepareVibeCodingUsage(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeVibeCodingUsage(report);
  if (!payload) throw new Error("vibeCodingUsage 必须是 Mac Telemetry Hub 的用量摘要");
  return { commit: () => usageMirror.put({ payload, pushedAt: receivedAt }) };
}

export function prepareVibeCodingNow(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeVibeCodingNow(report);
  if (!payload) throw new Error("vibeCodingNow 必须带 agents 数组");
  return {
    /** 推给浏览器的此刻补丁。用量还没到过也推 —— 它不依赖那份 */
    now: { agents: payload.agents } satisfies VibeCodingNowPayload,
    commit: () => nowMirror.put({ payload, pushedAt: receivedAt }),
  };
}

/**
 * 新鲜度只盖 pushedAt / lastSeenAt / declaredOffline，stale 由浏览器现算。
 */
export async function getVibeCodingSnapshot(): Promise<VibeCodingPayload> {
  const [usageState, nowState, liveness] = await Promise.all([
    usageMirror.get(),
    nowMirror.get(),
    readLiveness(),
  ]);
  // 用量是主干：总量、限额、模型排行都在它那份里，缺了就没有卡片可言。
  // 此刻那份缺了只是灯不亮，整张卡照旧。
  if (!usageState) throw new Error("尚未收到 Mac Telemetry Hub 的 vibe coding 用量推送");

  const nowById = new Map(
    (nowState?.payload.agents ?? []).map((agent) => [agent.id, agent]),
  );

  const agents: VibeCodingAgent[] = usageState.payload.agents.map((agent) => {
    const live = nowById.get(agent.id);
    return {
      ...agent,
      // now 说的是「此刻在用哪个」，取不到才退回用量那份的「最近一个有用量日
      // 的主力模型」。两个模块各送各的，优先级在这里定，采集端互不知情。
      currentModel: live?.currentModel ?? agent.currentModel,
      lastActivityAt: live?.lastActivityAt ?? null,
      active: live?.active ?? false,
    };
  });

  return withPresence(
    {
      agents,
      totals: usageState.payload.totals,
      topModels: usageState.payload.topModels,
      collectedAt: usageState.payload.collectedAt,
      source: "push" as const,
      pushedAt: usageState.pushedAt,
    },
    liveness,
  );
}
