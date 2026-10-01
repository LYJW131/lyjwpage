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
import { LAG_KEYS } from "@shared/lag";
import { markLagPending } from "../lag-mirror";


export type CodingUsageLanding = {
  stage: (batch: StorageBatch) => void;
  commit: () => Promise<unknown>;
  tags: string[];
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

// error 保留上次成功采集时刻；同一时刻的 ok 是旧重发，不能盖掉后来的 error。
function staleSnapshot(incoming: CodingUsageAgent, stored: StoredCodingUsageAgent): boolean {
  if (stored.collectedAt == null) return false;
  if (incoming.collectedAt == null || incoming.collectedAt < stored.collectedAt) return true;
  return incoming.collectedAt === stored.collectedAt && incoming.state === "ok" && stored.state === "error";
}

function sameUsage(left: StoredCodingUsageAgent, right: StoredCodingUsageAgent): boolean {
  return left.sessionCount === right.sessionCount && JSON.stringify(left.days) === JSON.stringify(right.days);
}

function sameStatus(left: StoredCodingUsageAgent, right: StoredCodingUsageAgent): boolean {
  return left.state === right.state && left.collectedAt === right.collectedAt && left.error === right.error && left.warning === right.warning;
}

// derived 账本按提交顺序做差，不得按接收时刻淘汰，否则乱序提交会丢失有效增量。
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
      markLagPending(batch.patch(codingUsageKey(source), fields).set(codingViewKey(), JSON.stringify(patched)), LAG_KEYS.codingUsage);
    }, codingLayoutKey(previousView) !== codingLayoutKey(patched) ? [CODING_TAG] : [], changed);
  }

  stored[source] = own;
  const { view, year } = buildCodingUsageView(stored, Math.max(receivedAt, previousView?.updatedAt ?? 0));
  const tags = codingLayoutKey(previousView) !== codingLayoutKey(view) ? [CODING_TAG] : [];
  return landing((batch) => {
    if (changed) batch.patch(codingUsageKey(source), fields);
    if (usageChanged) batch.set(codingUsageRevisionKey(), String(revision));
    batch.set(codingViewKey(), JSON.stringify(view)).set(codingYearKey(), JSON.stringify(year));
    markLagPending(batch, LAG_KEYS.codingUsage, LAG_KEYS.codingYear);
  }, tags, changed);
}
