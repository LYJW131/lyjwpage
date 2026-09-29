import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import type { StateCoreRpc } from "@shared/state-core";
import { fetchText } from "@/lib/agent-status";
import { agentStatusFingerprint, collectAgentStatus } from "@/lib/agent-status-parse";
import type { AgentStatusPayload } from "@/lib/agent-status-types";

import { explain, ok, type Job, type JobResult } from "../job";

type Collect = (previous: AgentStatusPayload | null, now: number) => Promise<AgentStatusPayload>;

const collectLive: Collect = (previous, now) => collectAgentStatus(previous, fetchText, now);

/** 同一 isolate 里上一轮自己写下的那份 */
type Memo = { last?: AgentStatusPayload };
const isolateMemo: Memo = {};

/**
 * 厂商状态页（已登记的厂商，见 lib/agent-status-parse 的 `FALLBACK`；各家失败沿用上一轮
 * 那一行并标 stale；全部失败整轮抛错、不写，监控报错）。
 *
 * 上一轮是可滞后层里那份；KV 读可能来自边缘缓存、落后一分钟，所以同一 isolate 里
 * 自己上一轮写的那份更新时用它。结果整份写回去；灯色、事件或失败标记变了（指纹
 * 不算检查时刻）才让状态核心失效首屏的 `agent-status` 标签。失效失败只记日志 ——
 * KV 已经写好了，下一次变化还会再发。
 */
export async function refreshProviderStatus(
  deps: { lag: LagStore; core: Pick<StateCoreRpc, "revalidate">; collect?: Collect; memo?: Memo },
  now = Date.now(),
): Promise<JobResult> {
  const memo = deps.memo ?? isolateMemo;
  const stored = (await readLag<AgentStatusPayload>(deps.lag, LAG_KEYS.agentStatus))?.data ?? null;
  const previous = memo.last && (!stored || memo.last.fetchedAt > stored.fetchedAt) ? memo.last : stored;
  const payload = await (deps.collect ?? collectLive)(previous, now);
  await writeLag(deps.lag, LAG_KEYS.agentStatus, payload, now);
  memo.last = payload;
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
