import { mirrorKey } from "@/lib/storage";
import type { ParsedCursorUsage } from "@/lib/cursor-usage";

/**
 * 容器上报的 Cursor 日桶。和 Mac 的 usage 镜像分开：
 * 读出口才把两者拼起来，Mac 原件留着，下一封 Mac 用量可以整份换掉。
 */
export const cursorUsageMirror = mirrorKey<{ report: ParsedCursorUsage; pushedAt: number }>(
  ["vibecoding", "cursor-usage"],
  (state) => state.pushedAt,
);
