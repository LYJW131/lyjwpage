import { mirrorKey } from "@/lib/storage";
import type { ParsedCursorUsage } from "@/lib/cursor-usage";
import type { ParsedCursorNow } from "@/lib/vibecoding-parse";

/**
 * 容器上报的 Cursor 日桶。和 Mac 的 usage 镜像分开：
 * 读出口才把两者拼起来，Mac 原件留着，下一封 Mac 用量可以整份换掉。
 */
export const cursorUsageMirror = mirrorKey<{ report: ParsedCursorUsage; pushedAt: number }>(
  ["vibecoding", "cursor-usage"],
  (state) => state.pushedAt,
);

/**
 * 容器上报的 Cursor 最近一条用量事件。不进 `vibecoding:now`：那份是 Mac 整份替换的，
 * 下一封 Mac 推送就会把这行抹掉；Pulse 吃的也是那份，不该被云端 agent 的活动带动。
 */
export const cursorNowMirror = mirrorKey<{ now: ParsedCursorNow; pushedAt: number }>(
  ["vibecoding", "cursor-now"],
  (state) => state.pushedAt,
);
