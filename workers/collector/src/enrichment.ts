import type { PlayingQueueTrack } from "@shared/playing-queue";
import { withRequestState } from "@shared/request-state";
import { enrichTrackOutcome, followUpEnrichment, type EnrichmentFollowUp, type EnrichmentOutcome } from "@shared/track-enrichment";
import type { LocalNowPlaying } from "@shared/types";

import type { Env } from "./env";
import { explain } from "./job";

export function enrichTrack(music: LocalNowPlaying | null, upcomingTracks: PlayingQueueTrack[]): Promise<EnrichmentOutcome | null> {
  return withRequestState(() => enrichTrackOutcome(music, Array.isArray(upcomingTracks) ? upcomingTracks : []));
}

export function followUpTrack(env: Env, followUp: EnrichmentFollowUp): Promise<void> {
  return withRequestState(() => followUpEnrichment(followUp, async (patch) => {
    await env.CORE.commitEnrichmentPatch(patch);
  })).catch((error: unknown) => {
    console.warn("[enrichment] follow-up", followUp.target, followUp.music?.title, explain(error));
  });
}
