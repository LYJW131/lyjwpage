import { AwaitingReport } from "@/lib/awaiting-report";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import type {
  VibeCodingPayload,
  VibeCodingUsageAgent
} from "@/lib/types";
import {
  normalizeVibeCodingUsage
} from "@/lib/vibecoding-parse";
import { claudeCloudNow, mergeClaudeCloudUsage } from "@/lib/claude-cloud-usage";
import { mergeCursorUsage } from "@/lib/cursor-usage";
import { claudeCloudUsageMirror } from "@shared/claude-cloud-usage";
import { cursorNowMirror, cursorUsageMirror } from "@shared/cursor-usage";
import { nowMirror, usageMirror } from "@shared/vibecoding";
import { placeholderAgent } from "@/lib/vibecoding-limits";
import { yearMirror } from "@shared/vibecoding-year-store";

/**
 * 用量与此刻（实时层）。限额在可滞后层，浏览器按 id 贴回（见 lib/vibecoding-limits）。
 * 新鲜度只盖 pushedAt / lastSeenAt / declaredOffline，stale 由浏览器现算。
 */
export async function getVibeCodingSnapshot(): Promise<VibeCodingPayload> {
  const [usageState, nowState, cursorState, cursorNowState, cloudState, yearState, liveness] = await Promise.all([
    usageMirror.get(),
    nowMirror.get(),
    cursorUsageMirror.get(),
    cursorNowMirror.get(),
    claudeCloudUsageMirror.get(),
    yearMirror.get(),
    readLiveness(),
  ]);
  const storedUsage = usageState ? normalizeVibeCodingUsage(usageState.payload) : null;
  // 年度图一起拿进来，新的 Cursor / 云端活动日才能把 Active 加上。不在这里改年度图本身。
  const now = Date.now();
  const withCursor = storedUsage
    ? mergeCursorUsage(storedUsage, cursorState?.report ?? null, yearState, now)
    : null;
  const usage = withCursor
    ? mergeClaudeCloudUsage(withCursor.usage, cloudState?.usage ?? null, withCursor.year, now).usage
    : null;
  // 此刻可先于用量到达：有任一份就出这张卡，累计总量保留 null
  if (!usage && !nowState && !cursorNowState) throw new AwaitingReport("尚未收到 vibe coding 用量推送");

  const nowById = new Map(
    (nowState?.payload.agents ?? []).map((agent) => [agent.id, agent]),
  );
  // Cursor 的此刻来自容器查的用量事件，不在 Mac 那份里。电平给 false，浏览器按时刻现算。
  if (cursorNowState) {
    nowById.set("cursor", { id: "cursor", ...cursorNowState.now, active: false });
  }

  // 只有此刻、还没有用量摘要的来源（比如 Cursor 的灯）也给一行，灯才亮得出来
  const usageRows: VibeCodingUsageAgent[] = (usage?.agents ?? []).map((agent) => ({ ...agent, lastActivityAt: null, active: false }));
  const known = new Set(usageRows.map((agent) => agent.id));
  for (const id of nowById.keys()) if (!known.has(id)) usageRows.push(placeholderAgent(id));

  const agents: VibeCodingUsageAgent[] = usageRows.map((agent) => {
    const live = nowById.get(agent.id);
    const row = {
      ...agent,
      // 此刻模型优先于历史摘要
      currentModel: live?.currentModel ?? agent.currentModel,
      lastActivityAt: live?.lastActivityAt ?? null,
      active: live?.active ?? false,
    };
    if (agent.id !== "claude" || !cloudState) return row;
    // 云端线程的灯单独一个时刻，不进 Mac 那个电平：Mac 合盖时那个电平不算数，云端的照样算
    const cloud = claudeCloudNow(cloudState.usage, live ?? null);
    return { ...row, cloudActivityAt: cloud.cloudActivityAt, currentModel: cloud.currentModel ?? row.currentModel };
  });

  return withPresence(
    {
      agents,
      totals: usage?.totals ?? null,
      topModels: usage?.topModels ?? [],
      collectedAt: usage?.collectedAt ?? null,
      source: "push" as const,
      pushedAt: usage && usageState ? usageState.pushedAt : null,
    },
    liveness,
  );
}
