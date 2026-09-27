import { mirrorKey } from "@/lib/storage";
import type { ClaudeCloudUsage } from "@/lib/claude-cloud-usage";

/**
 * Claude Code 云端线程经 OTLP 推来的日桶和进程计数器。和 Mac 的 usage 镜像分开：
 * 读出口才把两者拼起来，Mac 原件留着，下一封 Mac 用量可以整份换掉。
 */
export const claudeCloudUsageMirror = mirrorKey<{ usage: ClaudeCloudUsage; pushedAt: number; taggedAt: number | null }>(
  ["vibecoding", "claude-cloud-usage"],
  (state) => state.pushedAt,
);
