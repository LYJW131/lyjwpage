import { loadLag, type LagResult } from "@/lib/lag-result";
import type { AgentLimitsPayload } from "@/lib/vibecoding-limits";
import { LAG_KEYS } from "@shared/lag";

export function getAgentLimits(): Promise<LagResult<AgentLimitsPayload>> {
  return loadLag<AgentLimitsPayload>(LAG_KEYS.limits, "尚未收到限额上报");
}
