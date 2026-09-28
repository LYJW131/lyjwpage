import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import type { StateCoreRpc } from "@shared/state-core";
import { fetchText } from "@/lib/agent-status";
import { agentStatusFingerprint, collectAgentStatus } from "@/lib/agent-status-parse";
import type { AgentStatusPayload } from "@/lib/agent-status-types";

import { explain, ok, type Job, type JobResult } from "../job";

type Collect = (previous: AgentStatusPayload | null, now: number) => Promise<AgentStatusPayload>;

const collectLive: Collect = (previous, now) => collectAgentStatus(previous, fetchText, now);

/**
 * 厂商状态页，每分钟一轮（九家，各家失败沿用上一轮那一行并标 stale）。
 *
 * 上一轮就是可滞后层里那份，结果整份写回去；灯色、事件或失败标记变了（指纹不算
 * 检查时刻）才让状态核心失效首屏的 `agent-status` 标签。失效失败只记日志 ——
 * KV 已经写好了，下一次变化还会再发。
 */
export async function refreshProviderStatus(
  deps: { lag: LagStore; core: Pick<StateCoreRpc, "revalidate">; collect?: Collect },
  now = Date.now(),
): Promise<JobResult> {
  const previous = (await readLag<AgentStatusPayload>(deps.lag, LAG_KEYS.agentStatus))?.data ?? null;
  const payload = await (deps.collect ?? collectLive)(previous, now);
  await writeLag(deps.lag, LAG_KEYS.agentStatus, payload, now);
  if (agentStatusFingerprint(previous) === agentStatusFingerprint(payload)) return ok();
  try {
    await deps.core.revalidate(["agent-status"]);
  } catch (error) {
    console.warn("[provider-status] revalidate", explain(error));
  }
  return ok("changed");
}

export const providerStatusJob: Job = {
  name: "provider-status",
  everyMinutes: 1,
  offset: 0,
  maxRuntimeMinutes: 2,
  run: ({ env }) => refreshProviderStatus({ lag: env.LAG, core: env.CORE }),
};
