import { parseOtlpUsage, type OtlpUsagePoint } from "@/lib/claude-cloud-usage";

/**
 * Claude Code 云端线程的 OTLP 指标（`/api/ingest/agents/otlp`，Access 权限 `ingest:agents-otlp`）。
 * 这里只解析、丢掉账号字段，不碰状态；累计值做差在状态核心（workers/api/src/stores/claude-cloud.ts）。
 */
export type PreparedClaudeCloudUsage = {
  source: "agents-otlp";
  receivedAt: number;
  points: OtlpUsagePoint[];
};

export function prepareClaudeCloudUsage(raw: unknown, receivedAt = Date.now()): PreparedClaudeCloudUsage {
  return { source: "agents-otlp", receivedAt, points: parseOtlpUsage(raw, receivedAt) };
}
