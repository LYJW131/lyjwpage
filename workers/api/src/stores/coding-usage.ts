import { codingLayoutKey } from "@/lib/home-layout";
import { CODING_TAG } from "@/lib/live-events";
import { askStorage, tellStorage } from "@/lib/storage";
import {
  codingUsageKey,
  codingUsageRevisionKey,
  codingViewKey,
  codingYearKey,
  parseRevision,
  parseStoredUsageLedgers,
  parseStoredView,
} from "@shared/coding-store";
import type { CodingUsageAgent, CodingUsageReport } from "@shared/coding-usage";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { applyCodingUsageStatus, buildCodingUsageView, type StoredCodingUsage, type StoredCodingUsageAgent } from "@shared/coding-usage-view";
import type { StorageBatch } from "@shared/storage-client";


/**
 * 用量事实（日行）的状态核心那一半：Mac 的 `codingUsage`、agents 的 `codingUsage`，以及云端 OTLP
 * 做差后整理成的同形账本（stores/claude-cloud）都走这里。
 *
 * 一封里出现的 (来源, agent) 整份替换它的账本，`state: "error"` 只换状态、日子沿用上一份；
 * Mac 与 agents 报来的是整份快照，采集时刻比存着的旧（重发、乱序晚到）的那一格不收。云端 OTLP
 * 的账本是状态核心按提交顺序做差攒出来的（`derived`），不走这道淘汰。StateHub 串行提交，读三个
 * 来源的账本、重算、写回之间不会插进别的上报。
 *
 * 日子或会话数变了才重扫日行，重算视图、重写年度（`coding:usage:year`），账本修订号
 * `coding:usage:revision` 加一、改到的账本记下它（同一个事务）—— D1 归档按修订号挑要重写的账本，
 * 不按时刻：时刻只取「和存着的较大者」，入口顺序与提交顺序相反时会停在水位上。只有状态变了（采集时刻
 * 往前走、出错 / 恢复）就在存着的视图上换掉那几格状态（shared/coding-usage-view 的 applyCodingUsageStatus），
 * 不重扫日行、年度不写、修订号不动：Mac 每一轮采集都带着新的采集时刻整份发来，日子多半没变。
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
 * `derived`：这份账本是状态核心自己按提交顺序攒出来的（云端 OTLP），不是来源报来的快照，
 * 不按采集时刻淘汰 —— 入口先收到的那封可能后提交，它做出来的差值照样要进账本。
 */
export async function prepareCodingUsage(
  source: CodingUsageSource,
  report: CodingUsageReport,
  receivedAt: number,
  { derived = false }: { derived?: boolean } = {},
): Promise<CodingUsageLanding> {
  const answered = await askStorage(async (storage) => {
    const batch = storage.batch();
    for (const name of CODING_USAGE_SOURCE_NAMES) batch.fields(codingUsageKey(name));
    batch.get(codingViewKey()).get(codingUsageRevisionKey());
    return batch.execute();
  });
  if (!answered.reachable) throw new Error("coding 用量账本读不到");
  const stored: StoredCodingUsage = {};
  CODING_USAGE_SOURCE_NAMES.forEach((name, index) => {
    stored[name] = parseStoredUsageLedgers(answered.value[index]);
  });
  const previousView = parseStoredView(answered.value[CODING_USAGE_SOURCE_NAMES.length]);
  const revision = parseRevision(answered.value[CODING_USAGE_SOURCE_NAMES.length + 1]) + 1;

  const own = { ...stored[source] };
  const fields: Record<string, string> = {};
  const statusOnly: Record<string, StoredCodingUsageAgent> = {};
  let usageChanged = false;
  for (const agent of report.agents) {
    const previous = own[agent.id];
    if (previous && !derived && staleSnapshot(agent, previous)) continue;
    const next = ledgerOf(agent, previous, Math.max(receivedAt, previous?.receivedAt ?? 0));
    if (previous && sameUsage(previous, next)) {
      if (sameStatus(previous, next)) continue;
      own[agent.id] = { ...next, receivedAt: previous.receivedAt, revision: previous.revision };
      statusOnly[agent.id] = own[agent.id]!;
    } else {
      own[agent.id] = { ...next, revision };
      usageChanged = true;
    }
    fields[agent.id] = JSON.stringify(own[agent.id]);
  }
  const changed = Object.keys(fields).length > 0;
  if (!changed) return NOTHING;

  const patched = !usageChanged && previousView ? applyCodingUsageStatus(previousView, source, statusOnly) : null;
  if (patched) {
    return landing((batch) => {
      batch.patch(codingUsageKey(source), fields).set(codingViewKey(), JSON.stringify(patched));
    }, codingLayoutKey(previousView) !== codingLayoutKey(patched) ? [CODING_TAG] : [], changed);
  }

  stored[source] = own;
  const { view, year } = buildCodingUsageView(stored, Math.max(receivedAt, previousView?.updatedAt ?? 0));
  const tags = codingLayoutKey(previousView) !== codingLayoutKey(view) ? [CODING_TAG] : [];
  return landing((batch) => {
    if (changed) batch.patch(codingUsageKey(source), fields);
    if (usageChanged) batch.set(codingUsageRevisionKey(), String(revision));
    batch.set(codingViewKey(), JSON.stringify(view)).set(codingYearKey(), JSON.stringify(year));
  }, tags, changed);
}
