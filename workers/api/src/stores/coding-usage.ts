import { codingLayoutKey } from "@/lib/home-layout";
import { CODING_TAG } from "@/lib/live-events";
import { askStorage, tellStorage } from "@/lib/storage";
import { codingUsageKey, codingViewKey, codingYearKey, parseStoredUsageLedgers, parseStoredView } from "@shared/coding-store";
import type { CodingUsageReport } from "@shared/coding-usage";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { buildCodingUsageView, type StoredCodingUsage, type StoredCodingUsageAgent } from "@shared/coding-usage-view";

import { migrateLegacyCodingUsage } from "./coding-usage-migrate";

/**
 * 用量事实（日行）的状态核心那一半：Mac 的 `codingUsage`、agents 的 `codingUsage`，以及云端 OTLP
 * 做差后整理成的同形账本（stores/claude-cloud）都走这里。
 *
 * 一封里出现的 (来源, agent) 整份替换它的账本，`state: "error"` 只换状态、日子沿用上一份；
 * 账本真的变了才在同一次提交里重算视图（`coding:usage:view` / `coding:usage:year`）。StateHub 串行
 * 提交，读三个来源的账本、重算、写回之间不会插进别的上报。
 *
 * 首屏标签 `coding` 只在卡片骨架变了才打（src/lib/home-layout 的 codingLayoutKey）：新旧两份视图
 * 这里都在手上，和充电头一样在提交时比，不再像从前那样由出口再读一遍拼好的骨架。
 */
export type CodingUsageLanding = {
  commit: () => Promise<unknown>;
  tags: string[];
  /** 这封有没有改到账本（没改就什么都不写） */
  changed: boolean;
};

function ledgerOf(agent: CodingUsageReport["agents"][number], previous: StoredCodingUsageAgent | undefined, receivedAt: number): StoredCodingUsageAgent {
  const { days, ...status } = agent;
  return { ...status, days: days ?? previous?.days ?? [], receivedAt };
}

/** 除了收到时刻之外一模一样：不算变化，不写、不重算 */
function sameLedger(left: StoredCodingUsageAgent | undefined, right: StoredCodingUsageAgent): boolean {
  if (!left) return false;
  return JSON.stringify({ ...left, receivedAt: 0 }) === JSON.stringify({ ...right, receivedAt: 0 });
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
  for (const agent of report.agents) {
    const next = ledgerOf(agent, own[agent.id], receivedAt);
    if (sameLedger(own[agent.id], next)) continue;
    own[agent.id] = next;
    fields[agent.id] = JSON.stringify(next);
  }
  const changed = Object.keys(fields).length > 0;
  if (!changed && !migrated) return { commit: async () => {}, tags: [], changed: false };

  stored[source] = own;
  const { view, year } = buildCodingUsageView(stored, receivedAt);
  const tags = codingLayoutKey(previousView) !== codingLayoutKey(view) ? [CODING_TAG] : [];
  return {
    commit: () => tellStorage((storage) => {
      const batch = storage.batch();
      if (changed) batch.patch(codingUsageKey(source), fields);
      return batch
        .set(codingViewKey(), JSON.stringify(view))
        .set(codingYearKey(), JSON.stringify(year))
        .execute();
    }),
    tags,
    changed,
  };
}
