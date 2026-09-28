import { SERVER_STALE_MS } from "@/lib/freshness";
import { LIMITS_TAG, SERVER_TAG } from "@/lib/live-events";
import { REPORTER_BY_SOURCE, type ReporterBlock, type ReporterStat } from "@/lib/reporter-ledger";
import type { ServerPayload, TimezoneActivity } from "@/lib/types";
import { agentLimitsLayoutKey, mergeAgentLimits, type AgentLimitsPayload } from "@/lib/vibecoding-limits";
import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import type { PreparedIngest } from "./ingest-handlers";

/**
 * 上报入口对可滞后层的那一半：一封上报里不需要「变了立刻推」、也不参与 pulse 的
 * 部分，直接写 KV（格式见 shared/lag.ts），不经过状态核心。
 *
 * - server：整封都在这里（落地节点读数 + 账本），状态核心不再存它。
 * - agents：限额按 id 合并后写回，账本单独一条；Cursor 的用量与此刻仍进状态核心。
 * - mac：只有 timezone 模块在这里，其余模块照旧进状态核心。
 *
 * 只在这封上报的状态核心那一半成功之后才写，返回要失效的首屏标签（只在布局变化时，
 * 判据和从前一样，见 lib/home-layout）。KV 读的是写入方自己上一次写的值，
 * 跨机房最多滞后一分钟左右；这几路上报至少隔一分钟一封，判据里的读改写不会撞上。
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
      // 时区一年变两次：只在模块带来时重写；模块关掉了就写成 null。卡片定高，换时区只换内容，不失效首屏
      if ("timezone" in command.modules) {
        await writeTimezone(kv, command.modules.timezone ?? null, command.receivedAt);
      } else if (!command.activeModules.includes("timezone")) {
        const previous = await readLag<{ timezone: TimezoneActivity | null }>(kv, LAG_KEYS.timezone);
        if (previous?.data.timezone) await writeTimezone(kv, null, command.receivedAt);
      }
      return [];
    }
    default:
      return [];
  }
}

function writeTimezone(kv: LagStore, timezone: TimezoneActivity | null, at: number): Promise<void> {
  return writeLag(kv, LAG_KEYS.timezone, { timezone }, at);
}

/** 常驻上报器的账本：一个上报器一条，收下就覆盖；块写坏或旧版没带就不写 */
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
