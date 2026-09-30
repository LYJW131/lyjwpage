import { object } from "@/lib/json";
import { normalizeAgentLimits, type ParsedAgentLimits } from "@/lib/agent-limits-parse";

import { describeRejections, prepareCodingModules, type CodingModuleRejection, type CodingModules } from "./coding";

export type PreparedAgentLimits = CodingModules & {
  source: "agents";
  receivedAt: number;
  limits: ParsedAgentLimits | null;
  rejected: CodingModuleRejection[];
};

export function prepareAgentLimits(input: unknown, receivedAt = Date.now()): PreparedAgentLimits {
  const root = object(input);
  if (!root) throw new Error("agents 上报必须是对象");
  const { modules, rejected } = prepareCodingModules(root, receivedAt);
  const hasCoding = Object.keys(modules).length > 0;

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
