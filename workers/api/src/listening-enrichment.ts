import type { ListeningItem, LocalNowPlaying } from "@/lib/types";
import type { PlayingQueueTrack } from "@/lib/playing-queue";
import {
  enrichTrackOutcome,
  mergeEnrichment,
  prewarmLyrics,
  resolveMotion,
  RETRY_BUDGET,
  type EnrichmentOutcome,
  type TrackEnrichment,
  upcomingKeyOf,
} from "@/lib/track-enrichment";
import type { CoreCommand } from "@shared/ingest/prepare";

export type EnrichmentTarget = "mac" | "homepod";
// upcomingKey 是 enrichment.upcomingSongIds 所查的那份队列（upcomingKeyOf），写回时与已存的队列比对。
export type EnrichmentPatch = { target: EnrichmentTarget; enrichment: TrackEnrichment; upcomingKey: string };

export type EnrichmentFollowUp = {
  target: EnrichmentTarget;
  music: LocalNowPlaying;
  upcomingTracks: PlayingQueueTrack[];
  outcome: EnrichmentOutcome;
};

export type EnrichedCommand = { command: CoreCommand; followUp: EnrichmentFollowUp | null };

// 在 StateCore（DO 外）请求 Apple：补全完再交给 StateHub 落库，网络耗时不占提交队列。
export async function enrichCommand(command: CoreCommand): Promise<EnrichedCommand> {
  if (command.source === "homepod") {
    const music = command.stored.music;
    const outcome = await enrichTrackOutcome(music);
    return {
      command: { ...command, stored: { ...command.stored, enrichment: outcome?.enrichment ?? null } },
      followUp: outcome ? { target: "homepod", music, upcomingTracks: [], outcome } : null,
    };
  }
  if (command.source === "mac" && command.modules.appleMusic) {
    const appleMusic = command.modules.appleMusic;
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

// 回执之后跑：歌词预热；写入时有段没查出结果就整份重查一次，比写入时那份多查到东西才交给 commit 补写。
// 必须在新的请求状态里调用：apple-cache 按请求记住失败，同一请求里重试会直接拿到上次的错误。
export async function followUpEnrichment(
  followUp: EnrichmentFollowUp,
  commit: (patch: EnrichmentPatch) => Promise<void>,
): Promise<void> {
  const { target, music, upcomingTracks, outcome } = followUp;
  if (outcome.catalogKnown && outcome.upcomingKnown && outcome.motionKnown) {
    await prewarmLyrics(outcome.enrichment, music.title);
    return;
  }
  const retried = (await enrichTrackOutcome(music, upcomingTracks, RETRY_BUDGET))?.enrichment ?? null;
  const merged = retried && mergeEnrichment(outcome.enrichment, retried, true);
  await Promise.all([
    prewarmLyrics(merged || outcome.enrichment, music.title),
    merged ? commit({ target, enrichment: retried, upcomingKey: upcomingKeyOf(upcomingTracks) }) : null,
  ]);
}

// 首项是没在播放时的主图，只给它补动态封面；查不出结果时 motion 留 undefined，由提交侧沿用已存的那份。
export async function enrichRecentlyPlayed(items: ListeningItem[]): Promise<ListeningItem[]> {
  const [first, ...rest] = items;
  if (!first) return items;
  return [{ ...first, motion: await resolveMotion(first.link, first.title) }, ...rest];
}
