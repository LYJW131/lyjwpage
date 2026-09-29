import { codingLayoutKey } from "@/lib/home-layout";
import { CODING_TAG } from "@/lib/live-events";
import { askStorage, tellStorage } from "@/lib/storage";
import { codingUsageKey, codingViewKey, codingYearKey, parseStoredUsageLedgers, parseStoredView } from "@shared/coding-store";
import type { CodingUsageAgent, CodingUsageReport } from "@shared/coding-usage";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { buildCodingUsageView, type StoredCodingUsage, type StoredCodingUsageAgent } from "@shared/coding-usage-view";
import type { StorageBatch } from "@shared/storage-client";

import { migrateLegacyCodingUsage } from "./coding-usage-migrate";

/**
 * 用量事实（日行）的状态核心那一半：Mac 的 `codingUsage`、agents 的 `codingUsage`，以及云端 OTLP
 * 做差后整理成的同形账本（stores/claude-cloud）都走这里。
 *
 * 一封里出现的 (来源, agent) 整份替换它的账本，`state: "error"` 只换状态、日子沿用上一份；
 * 采集时刻比存着的旧（重发、乱序晚到）的那一格不收。StateHub 串行提交，读三个来源的账本、
 * 重算、写回之间不会插进别的上报。
 *
 * 日子或会话数变了才重写年度（`coding:usage:year`），视图的 `updatedAt` 与账本的 `receivedAt`
 * 跟着前进 —— D1 归档按这两个时刻挑要重写的账本。只有状态变了（采集时刻往前走、出错 / 恢复）
 * 就只换账本和视图里的状态（视图照样由账本现算，写回去只差状态），年度不写、两个时刻都不动：
 * Mac 每一轮采集都带着新的采集时刻整份发来，日子多半没变，不能每轮都重写年度、让归档重扫全部历史。
 *
 * 首屏标签 `coding` 只在卡片骨架变了才打（src/lib/home-layout 的 codingLayoutKey）：新旧两份视图
 * 这里都在手上，和充电头一样在提交时比，不由出口再读一遍拼好的骨架。
 */
export type CodingUsageLanding = {
  /** 把这封的写入排进调用方的那一批，和别的写入在同一个事务里落（云端 OTLP 那条路要用） */
  stage: (batch: StorageBatch) => void;
  /** 单独落这封的写入 */
  commit: () => Promise<unknown>;
  tags: string[];
  /** 这封有没有改到账本（没改就什么都不写） */
  changed: boolean;
};

function landing(stage: (batch: StorageBatch) => void, tags: string[], changed: boolean): CodingUsageLanding {
  return {
    stage,
    commit: () => tellStorage((storage) => {
      const batch = storage.batch();
      stage(batch);
      return batch.execute();
    }),
    tags,
    changed,
  };
}

const NOTHING = landing(() => {}, [], false);

function ledgerOf(agent: CodingUsageAgent, previous: StoredCodingUsageAgent | undefined, receivedAt: number): StoredCodingUsageAgent {
  const { days, ...status } = agent;
  return { ...status, days: days ?? previous?.days ?? [], receivedAt };
}

/**
 * 这一格比存着的旧：整份替换会把较新的历史盖回去。`collectedAt` 是最近一次成功采集，
 * error 那一轮也停在上次成功的时刻，所以同一个时刻上 error 比 ok 新 —— ok 之后再成功一次，
 * 时刻就往前走了；时刻相同的 ok 只能是出错之前那封的重发。
 */
function staleSnapshot(incoming: CodingUsageAgent, stored: StoredCodingUsageAgent): boolean {
  if (stored.collectedAt == null) return false;
  if (incoming.collectedAt == null || incoming.collectedAt < stored.collectedAt) return true;
  return incoming.collectedAt === stored.collectedAt && incoming.state === "ok" && stored.state === "error";
}

/** 进合计的那部分：日子与会话数 */
function sameUsage(left: StoredCodingUsageAgent, right: StoredCodingUsageAgent): boolean {
  return left.sessionCount === right.sessionCount && JSON.stringify(left.days) === JSON.stringify(right.days);
}

/** 只进视图 `status` 的那部分 */
function sameStatus(left: StoredCodingUsageAgent, right: StoredCodingUsageAgent): boolean {
  return left.state === right.state && left.collectedAt === right.collectedAt && left.error === right.error && left.warning === right.warning;
}

/**
 * `recompute`：账本没变也重算一次视图 —— 调用方先跑过一次性迁移、转出了新账本时用
 * （云端 OTLP 那条路要在做差之前迁移，迁移的结果轮不到这里的那次调用看见）。
 */
export async function prepareCodingUsage(
  source: CodingUsageSource,
  report: CodingUsageReport,
  receivedAt: number,
  { recompute = false }: { recompute?: boolean } = {},
): Promise<CodingUsageLanding> {
  const migrated = (await migrateLegacyCodingUsage(receivedAt)) || recompute;
  const answered = await askStorage(async (storage) => {
    const batch = storage.batch();
    for (const name of CODING_USAGE_SOURCE_NAMES) batch.fields(codingUsageKey(name));
    batch.get(codingViewKey());
    return batch.execute();
  });
  if (!answered.reachable) throw new Error("coding 用量账本读不到");
  const stored: StoredCodingUsage = {};
  CODING_USAGE_SOURCE_NAMES.forEach((name, index) => {
    stored[name] = parseStoredUsageLedgers(answered.value[index]);
  });
  const previousView = parseStoredView(answered.value[CODING_USAGE_SOURCE_NAMES.length]);

  const own = { ...stored[source] };
  const fields: Record<string, string> = {};
  let usageChanged = false;
  for (const agent of report.agents) {
    const previous = own[agent.id];
    if (previous && staleSnapshot(agent, previous)) continue;
    const next = ledgerOf(agent, previous, receivedAt);
    if (previous && sameUsage(previous, next)) {
      if (sameStatus(previous, next)) continue;
      own[agent.id] = { ...next, receivedAt: previous.receivedAt };
    } else {
      own[agent.id] = next;
      usageChanged = true;
    }
    fields[agent.id] = JSON.stringify(own[agent.id]);
  }
  const changed = Object.keys(fields).length > 0;
  if (!changed && !migrated) return NOTHING;

  stored[source] = own;
  const previousAt = previousView?.updatedAt;
  const rebuild = usageChanged || migrated || previousAt == null;
  const { view, year } = buildCodingUsageView(stored, rebuild || previousAt == null ? receivedAt : previousAt);
  const tags = codingLayoutKey(previousView) !== codingLayoutKey(view) ? [CODING_TAG] : [];
  return landing((batch) => {
    if (changed) batch.patch(codingUsageKey(source), fields);
    batch.set(codingViewKey(), JSON.stringify(view));
    if (rebuild) batch.set(codingYearKey(), JSON.stringify(year));
  }, tags, changed);
}
