import { AwaitingReport } from "@/lib/awaiting-report";
import { agentLimitsStaleMs } from "@/lib/freshness";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import type {
  VibeCodingAgent,
  VibeCodingPayload
} from "@/lib/types";
import {
  attachAgentLimits
} from "@/lib/vibecoding-limits";
import {
  normalizeVibeCodingUsage
} from "@/lib/vibecoding-parse";
import { mergeCursorUsage } from "@/lib/cursor-usage";
import { cursorUsageMirror } from "@shared/cursor-usage";
import { limitsMirror, nowMirror, usageMirror } from "@shared/vibecoding";
import { yearMirror } from "@shared/vibecoding-year-store";

/**
 * 新鲜度只盖 pushedAt / lastSeenAt / declaredOffline / limitsAt，stale 由浏览器现算。
 */
export async function getVibeCodingSnapshot(): Promise<VibeCodingPayload> {
  const [usageState, nowState, limitsState, cursorState, yearState, liveness] = await Promise.all([
    usageMirror.get(),
    nowMirror.get(),
    limitsMirror.get(),
    cursorUsageMirror.get(),
    yearMirror.get(),
    readLiveness(),
  ]);
  const storedUsage = usageState ? normalizeVibeCodingUsage(usageState.payload) : null;
  // 年度图一起拿进来，新的 Cursor 活动日才能把 Active 加上。不在这里改年度图本身。
  const usage = storedUsage
    ? mergeCursorUsage(storedUsage, cursorState?.report ?? null, yearState, Date.now()).usage
    : null;
  // 限额可独立到达。没有用量时仍显示这些来源，累计总量保留 null。
  if (!usage && !limitsState) throw new AwaitingReport("尚未收到 vibe coding 用量或限额推送");

  const nowById = new Map(
    (nowState?.payload.agents ?? []).map((agent) => [agent.id, agent]),
  );

  const agents: VibeCodingAgent[] = attachAgentLimits(
    (usage?.agents ?? []).map((agent) => ({ ...agent, lastActivityAt: null, active: false })),
    limitsState,
  ).map((agent) => {
    const live = nowById.get(agent.id);
    return {
      ...agent,
      // 此刻模型优先于历史摘要；只有限额的行也可收到独立的本机会话状态。
      currentModel: live?.currentModel ?? agent.currentModel,
      lastActivityAt: live?.lastActivityAt ?? null,
      active: live?.active ?? false,
    };
  });

  return withPresence(
    {
      agents,
      totals: usage?.totals ?? null,
      topModels: usage?.topModels ?? [],
      collectedAt: usage?.collectedAt ?? null,
      source: "push" as const,
      pushedAt: usage && usageState ? usageState.pushedAt : null,
      limitsStaleAfterMs: agentLimitsStaleMs(),
    },
    liveness,
  );
}
