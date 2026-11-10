import { SERVER_STALE_MS } from "@shared/freshness";
import { workoutsLayoutKey } from "@shared/home-layout";
import { LIMITS_TAG, SERVER_TAG } from "@shared/live-events";
import { STATUS_VIEWS } from "@shared/status-views";
import { REPORTER_BY_SOURCE, type ReporterBlock, type ReporterStat } from "@shared/reporter-ledger";
import type { ActivityStatus, ServerPayload, TimezoneActivity, Workout } from "@shared/types";
import {
  agentLimitsLayoutKey,
  detectResetCardUse,
  mergeAgentLimits,
  spendResetCardFromStock,
  type AgentLimitsPayload,
  type ClaudeResetCardStock,
} from "@shared/vibecoding-limits";
import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import { publicServer } from "@shared/server";
import { publicWorkout } from "@shared/workouts";
import type { PreparedIngest } from "@shared/ingest/prepare";

// KV 读改写不互斥且最终一致；只允许后续上报可修正的展示快照走此路径。
export async function commitLagIngest(kv: LagStore, command: PreparedIngest): Promise<string[]> {
  switch (command.source) {
    case "server": {
      const previous = await readLag<ServerPayload>(kv, LAG_KEYS.server);
      const next: ServerPayload = { ...publicServer(command.status), pushedAt: command.receivedAt };
      await Promise.all([
        writeLag(kv, LAG_KEYS.server, next, command.receivedAt),
        writeLedger(kv, "server", command.reporter, command.receivedAt),
      ]);
      const layoutChanged =
        !previous ||
        command.receivedAt - previous.updatedAt > SERVER_STALE_MS ||
        (previous.data.traffic == null) !== (next.traffic == null);
      return layoutChanged ? [SERVER_TAG] : [];
    }
    case "agents": {
      const tags: string[] = [];
      const writes: Promise<void>[] = [writeLedger(kv, "agents", command.reporter, command.receivedAt)];
      if (command.limits) {
        const previous = await readLag<AgentLimitsPayload>(kv, LAG_KEYS.limits);
        const next = mergeAgentLimits(previous?.data ?? null, command.limits, command.receivedAt);
        writes.push(writeLag(kv, LAG_KEYS.limits, next, command.receivedAt));
        if (agentLimitsLayoutKey(previous?.data ?? null) !== agentLimitsLayoutKey(next)) tags.push(LIMITS_TAG);
        const used = detectResetCardUse(previous?.data.agents.claude, next.agents.claude, command.receivedAt);
        if (used.length && (await spendResetCard(kv, used, command.receivedAt)) && !tags.includes(LIMITS_TAG)) tags.push(LIMITS_TAG);
      }
      await Promise.all(writes);
      return tags;
    }
    case "mac": {
      if ("timezone" in command.modules) {
        await writeTimezone(kv, command.modules.timezone ?? null, command.receivedAt);
      } else if (!command.activeModules.includes("timezone")) {
        const previous = await readLag<{ timezone: TimezoneActivity | null }>(kv, LAG_KEYS.timezone);
        if (previous?.data.timezone) await writeTimezone(kv, null, command.receivedAt);
      }
      return [];
    }
    case "iphone": {
      const writes: Promise<void>[] = [];
      const tags: string[] = [];
      if (command.activity?.current) {
        const { activity, receivedAt } = command.activity.current;
        writes.push(writeLag<ActivityStatus>(kv, LAG_KEYS.activity, activity, receivedAt));
      }
      if (command.workouts) {
        const previous = await readLag<{ items: Workout[] }>(kv, LAG_KEYS.workouts);
        const next = { items: command.workouts.items.map(publicWorkout) };
        writes.push(writeLag(kv, LAG_KEYS.workouts, next, command.receivedAt));
        if (workoutsLayoutKey(previous?.data ?? null) !== workoutsLayoutKey(next)) tags.push(STATUS_VIEWS.workouts.tag);
      }
      await Promise.all(writes);
      return tags;
    }
    default:
      return [];
  }
}

// 记的是 lyjw 说过的卡，上报器读不到；读数显示用了一张就划掉一张，读数分不出卡种时扣手上有的那种，都没有就不动。
async function spendResetCard(kv: LagStore, kinds: (keyof ClaudeResetCardStock)[], at: number): Promise<boolean> {
  const cards = await readLag<ClaudeResetCardStock>(kv, LAG_KEYS.claudeResetCards);
  for (const kind of kinds) {
    const next = cards && spendResetCardFromStock(cards.data, kind, at);
    if (!next) continue;
    await writeLag(kv, LAG_KEYS.claudeResetCards, next, at);
    console.log("[reset-cards] 认出用了一张", kind);
    return true;
  }
  console.log("[reset-cards] 读数像用了卡，但记的没有没过期的", kinds);
  return false;
}

function writeTimezone(kv: LagStore, timezone: TimezoneActivity | null, at: number): Promise<void> {
  return writeLag(kv, LAG_KEYS.timezone, { timezone }, at);
}

function writeLedger(
  kv: LagStore,
  source: keyof typeof REPORTER_BY_SOURCE,
  block: ReporterBlock | null | undefined,
  at: number,
): Promise<void> {
  if (!block) return Promise.resolve();
  const key = source === "server" ? LAG_KEYS.reporterServer : LAG_KEYS.reporterAgents;
  const stat: ReporterStat = { ...block, lastPushAt: at };
  return writeLag(kv, key, stat, at);
}
