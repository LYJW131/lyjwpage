import type { ParsedCursorUsage } from "@/lib/cursor-usage";
import { object } from "@/lib/json";
import { normalizeAgentLimits, type ParsedAgentLimits, type ParsedCursorNow } from "@/lib/vibecoding-parse";

import { describeRejections, prepareCodingModules, type CodingModuleRejection, type CodingModules } from "./coding";

/**
 * `/api/ingest/agents`：容器上报器这一轮的限额，外加可选的三份 coding 数据
 * （`codingUsage` / `codingActivity` / `codingTokenBuckets`，契约见 shared/coding-usage，
 * 眼下只有 Cursor 一个 agent）。
 *
 * 限额按 id 合并写进可滞后层（上报入口直接写 KV，见 workers/ingress 的 lag-ingest）；
 * coding 数据进状态核心。
 *
 * Cursor 在用时容器每分钟单独发一封只带活动与桶的信封，不带 `agents`。不带就完全不碰限额 ——
 * 否则限额的心跳会被活动信号顶着，上报器限额那条路死了也看不出来。
 *
 * coding 数据坏了只丢那一份，原因进 `rejected`（见 ./coding），限额照写。被拒的不算「带了」：
 * 限额和三份 coding 数据一份可收的都没有时整封拒收。限额本身坏了仍然整封拒收。
 */
export type PreparedAgentLimits = CodingModules & {
  source: "agents";
  receivedAt: number;
  limits: ParsedAgentLimits | null;
  /** 校验不过、只丢了自己的 coding 数据 */
  rejected: CodingModuleRejection[];
  /**
   * 改名前的 Cursor 用量与此刻。入口不再收，这里只留类型，让还在读它们的状态核心照常编译；
   * 状态核心换到上面三份 coding 数据时一起删掉。
   */
  cursorUsage?: ParsedCursorUsage;
  cursorNow?: ParsedCursorNow;
};

export function prepareAgentLimits(input: unknown, receivedAt = Date.now()): PreparedAgentLimits {
  const root = object(input);
  if (!root) throw new Error("agents 上报必须是对象");
  const { modules, rejected } = prepareCodingModules(root, receivedAt);
  const hasCoding = Object.keys(modules).length > 0;

  // 空数组和缺省一样，是「这一轮不带限额」
  const limitsOmitted = root.agents == null || (Array.isArray(root.agents) && root.agents.length === 0);
  const limits = limitsOmitted ? null : normalizeAgentLimits(input);
  if (!limitsOmitted && !limits) throw new Error("agents 必须是带 id 的限额行数组，id 不能重复");

  if (!limits && !hasCoding) {
    throw new Error(
      rejected.length
        ? `agents 上报没有可收的数据：${describeRejections(rejected)}`
        : "agents 上报至少要带限额或一份 coding 数据",
    );
  }
  return { source: "agents", receivedAt, limits, ...modules, rejected };
}
