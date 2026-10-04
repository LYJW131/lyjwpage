import { resolveLyrics } from "@/lib/lyrics";
import type { ListeningItem } from "@/lib/types";
import { enrichTrack, resolveMotion, type EnrichmentOptions, type TrackEnrichment } from "@/lib/track-enrichment";
import type { CoreCommand } from "@shared/ingest/prepare";

import { afterResponse } from "./live-platform";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const OPTIONS: EnrichmentOptions = {
  background: (work) => void afterResponse(() => work),
};

// 歌词只有卡片展开才要，预热不占回执路径。
function prewarmLyrics(enrichment: TrackEnrichment | null): void {
  const songId = enrichment?.songId;
  if (!songId || !enrichment.hasLyrics) return;
  void afterResponse(() => resolveLyrics(songId).then(() => undefined, (error: unknown) => console.warn("[enrichment] lyrics", reason(error))));
}

// 在 StateCore（DO 外）请求 Apple：补全完再交给 StateHub 落库，网络耗时不占提交队列。
export async function enrichCommand(command: CoreCommand): Promise<CoreCommand> {
  if (command.source === "homepod") {
    const enrichment = await enrichTrack(command.stored.music, [], OPTIONS);
    prewarmLyrics(enrichment);
    return { ...command, stored: { ...command.stored, enrichment } };
  }
  if (command.source === "mac" && command.modules.appleMusic) {
    const appleMusic = command.modules.appleMusic;
    const enrichment = await enrichTrack(appleMusic.music, appleMusic.upcomingTracks, OPTIONS);
    prewarmLyrics(enrichment);
    return { ...command, modules: { ...command.modules, appleMusic: { ...appleMusic, enrichment } } };
  }
  return command;
}

// 首项是没在播放时的主图，只给它补动态封面。
export async function enrichRecentlyPlayed(items: ListeningItem[]): Promise<ListeningItem[]> {
  const [first, ...rest] = items;
  if (!first) return items;
  return [{ ...first, motion: await resolveMotion(first.link) }, ...rest];
}
