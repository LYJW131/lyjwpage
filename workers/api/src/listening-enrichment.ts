import { enrichCommand as enrichCommandWith, type EnrichedCommand } from "@shared/command-enrichment";
import type { CoreCommand } from "@shared/ingest/prepare";
import { enrichTrackOutcome } from "@shared/track-enrichment";

// 在 StateCore（DO 外）请求 Apple：补全完再交给 StateHub 落库，网络耗时不占提交队列。
// 上报入口请 collector 补全过的命令带着 enrichment（含 null）进来，这里原样提交；只有 collector 调不通时才在这里补。
export function enrichCommand(command: CoreCommand): Promise<EnrichedCommand> {
  return enrichCommandWith(command, enrichTrackOutcome);
}
