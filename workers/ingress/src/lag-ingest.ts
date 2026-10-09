import { SERVER_STALE_MS } from "@/lib/freshness";
import { workoutsLayoutKey } from "@/lib/home-layout";
import { LIMITS_TAG, SERVER_TAG } from "@/lib/live-events";
import { STATUS_VIEWS } from "@/lib/status-views";
import { REPORTER_BY_SOURCE, type ReporterBlock, type ReporterStat } from "@/lib/reporter-ledger";
import type { ActivityStatus, ServerPayload, TimezoneActivity, Workout } from "@/lib/types";
import { agentLimitsLayoutKey, mergeAgentLimits, type AgentLimitsPayload } from "@/lib/vibecoding-limits";
import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import { publicWorkout } from "@shared/workouts";
import type { PreparedIngest } from "@shared/ingest/prepare";

// KV 读改写不互斥且最终一致；只允许后续上报可修正的展示快照走此路径。
export async function commitLagIngest(kv: LagStore, command: PreparedIngest): Promise<string[]> {
  switch (command.source) {
    case "server": {
      const previous = await readLag<ServerPayload>(kv, LAG_KEYS.server);
      const next: ServerPayload = {
        ...command.status,
        traffic: command.status.traffic ?? null,
        pushedAt: command.receivedAt,
      };
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
