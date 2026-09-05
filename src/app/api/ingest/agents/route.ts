import { ingestRoute } from "@/lib/api";
import { recordAgentLimits } from "@/lib/vibecoding";

/**
 * 各 coding agent（Claude Code / Codex / Grok Build …）账号侧的套餐与限额窗口。
 *
 * 推送方是 NAS 上的容器上报器（reporters/agent-limits-reporter），它在容器里
 * 各家 CLI 登录一次、按各家的接口取限额。路径按数据是谁产生的命名 —— 这些是
 * 各 agent 账号的事实，不是某台设备的，也不是上报程序的名字。
 *
 * 从前限额搭 Mac 用量信封（/api/ingest/mac 的 vibeCodingUsage）的车，Mac 合盖
 * 就冻住；拆出来之后用量仍由 Mac 报，限额走这里，站点按 id 贴回同一行。
 */
export async function POST(request: Request) {
  return ingestRoute(request, recordAgentLimits);
}
