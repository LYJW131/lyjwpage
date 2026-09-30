import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import type { StateCoreRpc } from "@shared/state-core";
import { fetchText } from "@/lib/agent-status";
import { agentStatusFingerprint, collectAgentStatus } from "@/lib/agent-status-parse";
import type { AgentStatusPayload } from "@/lib/agent-status-types";

import { explain, ok, type Job, type JobResult } from "../job";

type Collect = (previous: AgentStatusPayload | null, now: number) => Promise<AgentStatusPayload>;

const collectLive: Collect = (previous, now) => collectAgentStatus(previous, fetchText, now);

type Memo = { last?: AgentStatusPayload };
const isolateMemo: Memo = {};

// KV 边缘缓存可能落后于本 isolate 上轮写入，选择基线时须比较内存副本的新旧。
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
