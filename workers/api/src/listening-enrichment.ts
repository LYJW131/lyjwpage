import type { ListeningItem } from "@/lib/types";
import { enrichTrack, resolveMotion } from "@/lib/track-enrichment";
import type { CoreCommand } from "@shared/ingest/prepare";

// 在 StateCore（DO 外）请求 Apple：补全完再交给 StateHub 落库，网络耗时不占提交队列。
export async function enrichCommand(command: CoreCommand): Promise<CoreCommand> {
  if (command.source === "homepod") {
    return { ...command, stored: { ...command.stored, enrichment: await enrichTrack(command.stored.music) } };
  }
  if (command.source === "mac" && command.modules.appleMusic) {
    const appleMusic = command.modules.appleMusic;
    const enrichment = await enrichTrack(appleMusic.music, appleMusic.upcomingTracks);
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
