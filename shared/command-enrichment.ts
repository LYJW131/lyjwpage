import type { CoreCommand } from "@shared/ingest/prepare";
import type { PlayingQueueTrack } from "@shared/playing-queue";
import type { EnrichmentFollowUp, EnrichmentOutcome } from "@shared/track-enrichment";
import type { LocalNowPlaying } from "@shared/types";

export type EnrichedCommand = { command: CoreCommand; followUp: EnrichmentFollowUp | null };
export type EnrichTrack = (music: LocalNowPlaying | null, upcomingTracks: PlayingQueueTrack[]) => Promise<EnrichmentOutcome | null>;

// 命令已带 enrichment（含 null）表示补全过，原样返回，回执后的预热与重查归补全它的一方。
export async function enrichCommand(command: CoreCommand, enrich: EnrichTrack): Promise<EnrichedCommand> {
  if (command.source === "homepod") {
    if (command.stored.enrichment !== undefined) return { command, followUp: null };
    const music = command.stored.music;
    const outcome = await enrich(music, []);
    return {
      command: { ...command, stored: { ...command.stored, enrichment: outcome?.enrichment ?? null } },
      followUp: outcome ? { target: "homepod", music, upcomingTracks: [], outcome } : null,
    };
  }
  if (command.source === "mac" && command.modules.appleMusic) {
    const appleMusic = command.modules.appleMusic;
    if (appleMusic.enrichment !== undefined) return { command, followUp: null };
    const outcome = await enrich(appleMusic.music, appleMusic.upcomingTracks);
    return {
      command: { ...command, modules: { ...command.modules, appleMusic: { ...appleMusic, enrichment: outcome?.enrichment ?? null } } },
      followUp: outcome && appleMusic.music
        ? { target: "mac", music: appleMusic.music, upcomingTracks: appleMusic.upcomingTracks, outcome }
        : null,
    };
  }
  return { command, followUp: null };
}
