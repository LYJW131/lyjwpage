import { SERVER_STALE_MS } from "@/lib/freshness";
import { workoutsLayoutKey } from "@/lib/home-layout";
import { LIMITS_TAG, SERVER_TAG } from "@/lib/live-events";
import { STATUS_VIEWS } from "@/lib/status-views";
import { REPORTER_BY_SOURCE, type ReporterBlock, type ReporterStat } from "@/lib/reporter-ledger";
import type { ActivityStatus, ServerPayload, TimezoneActivity, Workout } from "@/lib/types";
import { agentLimitsLayoutKey, mergeAgentLimits, type AgentLimitsPayload } from "@/lib/vibecoding-limits";
import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import type { PreparedIngest } from "@shared/ingest/prepare";

/**
 * 上报入口对可滞后层的那一半：一封上报里不需要「变了立刻推」、也不参与 pulse 的
 * 部分，直接写 KV（格式见 shared/lag.ts），不经过状态核心。
 *
 * - server：整封都在这里（落地节点读数 + 账本），状态核心不存它。
 * - agents：限额按 id 合并后写回，账本单独一条；Cursor 的用量与此刻仍进状态核心。
 * - mac：只有 timezone 模块在这里，其余模块照旧进状态核心。
 * - iphone：圆环读数与训练列表这两份展示快照在这里；状态核心只留 Pulse 要的
 *   五分钟桶和训练区间（见 stores/activity、stores/workouts）。
 *
 * 只在这封上报的状态核心那一半成功之后才写，返回要失效的首屏标签（只在布局变化时，
 * 判据见 lib/home-layout）。KV 最终一致：读到的可能是较旧的值（跨机房最多滞后一分钟左右），
 * 同一路的两封上报并发时读改写也没有互斥。数据靠后续上报纠正；布局判据偶尔漏判或多判一次，
 * 代价只是首屏晚一点更新或多重建一次。
 */
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
      // 卡片由空变有、上报器从断流里回来、流量那一行出现或消失，才算布局变了
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
      // 时区只在模块带来时重写；模块关掉了就写成 null。卡片定高，换时区只换内容，不失效首屏
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
      // 只写这封真带了的模块：只带历史桶的圆环上报不碰读数，`updatedAt` 是最后一次带来它的那封
      if (command.activity?.current) {
        const { activity, receivedAt } = command.activity.current;
        writes.push(writeLag<ActivityStatus>(kv, LAG_KEYS.activity, activity, receivedAt));
      }
      if (command.workouts) {
        const previous = await readLag<{ items: Workout[] }>(kv, LAG_KEYS.workouts);
        const next = { items: command.workouts.items };
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

/** 常驻上报器的账本：一个上报器一条，收下就覆盖；块缺省（写坏了或上报器没带）就不写 */
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
