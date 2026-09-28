import { loadLag, type LagResult } from "@/lib/lag-result";
import type { AgentLimitsPayload } from "@/lib/vibecoding-limits";
import { LAG_KEYS } from "@shared/lag";

/** 各 agent 账号的套餐与限额窗口；上报入口按 id 合并后写进可滞后层 */
export function getAgentLimits(): Promise<LagResult<AgentLimitsPayload>> {
  return loadLag<AgentLimitsPayload>(LAG_KEYS.limits, "尚未收到限额上报");
}
