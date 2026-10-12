import { loadLag, type LagResult } from "@shared/lag-result";
import type { AgentLimitsPayload } from "@shared/vibecoding-limits";
import { LAG_KEYS } from "@shared/lag";

export function getAgentLimits(): Promise<LagResult<AgentLimitsPayload>> {
  return loadLag<AgentLimitsPayload>(LAG_KEYS.limits, "尚未收到限额上报");
}
