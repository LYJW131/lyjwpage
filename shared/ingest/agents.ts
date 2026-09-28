import { normalizeCursorUsageReport, type ParsedCursorUsage } from "@/lib/cursor-usage";
import { normalizeAgentLimits, normalizeCursorNow, type ParsedAgentLimits, type ParsedCursorNow } from "@/lib/vibecoding-parse";

/**
 * `/api/ingest/agents`：容器上报器这一轮的限额，外加可选的 Cursor 用量日桶与此刻。
 *
 * 限额按 id 合并写进可滞后层（上报入口直接写 KV，见 workers/ingress 的 lag-ingest）；
 * Cursor 的用量与此刻进状态核心（workers/api/src/stores/vibecoding.ts）。
 *
 * `cursorNow` 是 Cursor 最近一条用量事件：平时随限额那一轮带上；Cursor 在用时容器每分钟
 * 查一次，变了单独发一封，这种信封不带 `agents`。不带就完全不碰限额 —— 否则限额的心跳会被
 * 活动信号顶着，上报器限额那条路死了也看不出来。`agents`、`cursorUsage`、`cursorNow` 三者全缺时拒收。
 */
export type PreparedAgentLimits = {
  source: "agents";
  receivedAt: number;
  limits: ParsedAgentLimits | null;
  cursorUsage?: ParsedCursorUsage;
  cursorNow?: ParsedCursorNow;
};

export function prepareAgentLimits(input: unknown, receivedAt = Date.now()): PreparedAgentLimits {
  const root = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  let cursorUsage: ParsedCursorUsage | undefined;
  if (root && "cursorUsage" in root && root.cursorUsage != null) {
    const report = normalizeCursorUsageReport(root.cursorUsage);
    if (!report) throw new Error("cursorUsage 必须是 Cursor 的日桶");
    cursorUsage = report;
  }
  let cursorNow: ParsedCursorNow | undefined;
  if (root && "cursorNow" in root && root.cursorNow != null) {
    const now = normalizeCursorNow(root.cursorNow);
    if (!now) throw new Error("cursorNow 必须带 lastActivityAt");
    cursorNow = now;
  }
  const omitted = !root || root.agents == null || (Array.isArray(root.agents) && root.agents.length === 0);
  const parsed = omitted && (cursorUsage || cursorNow) ? null : normalizeAgentLimits(input);
  if (!parsed && !(omitted && (cursorUsage || cursorNow))) {
    throw new Error("agents 必须是带 id 的限额行数组，id 不能重复");
  }
  return { source: "agents", receivedAt, limits: parsed, cursorUsage, cursorNow };
}
