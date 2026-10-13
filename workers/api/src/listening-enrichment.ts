import { enrichTrackOutcome, type EnrichmentFollowUp } from "@shared/track-enrichment";
import type { CoreCommand } from "@shared/ingest/prepare";

export type EnrichedCommand = { command: CoreCommand; followUp: EnrichmentFollowUp | null };

// 在 StateCore（DO 外）请求 Apple：补全完再交给 StateHub 落库，网络耗时不占提交队列。
// 命令已带 enrichment（含 null）表示上报入口已经请 collector 补全过，回执后的预热与重查也归它，这里原样提交。
export async function enrichCommand(command: CoreCommand): Promise<EnrichedCommand> {
  if (command.source === "homepod") {
    if (command.stored.enrichment !== undefined) return { command, followUp: null };
    const music = command.stored.music;
    const outcome = await enrichTrackOutcome(music);
    return {
      command: { ...command, stored: { ...command.stored, enrichment: outcome?.enrichment ?? null } },
      followUp: outcome ? { target: "homepod", music, upcomingTracks: [], outcome } : null,
    };
  }
  if (command.source === "mac" && command.modules.appleMusic) {
    const appleMusic = command.modules.appleMusic;
    if (appleMusic.enrichment !== undefined) return { command, followUp: null };
    const outcome = await enrichTrackOutcome(appleMusic.music, appleMusic.upcomingTracks);
    return {
      command: { ...command, modules: { ...command.modules, appleMusic: { ...appleMusic, enrichment: outcome?.enrichment ?? null } } },
      followUp: outcome && appleMusic.music
        ? { target: "mac", music: appleMusic.music, upcomingTracks: appleMusic.upcomingTracks, outcome }
        : null,
    };
  }
  return { command, followUp: null };
}
