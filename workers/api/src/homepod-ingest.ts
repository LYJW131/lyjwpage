import { mirror } from "@shared/homepod-store";
import { liveTrack } from "@/lib/home-layout";
import { keepEnrichment, mergeEnrichment, playableMusic, trackKeyOf, type TrackEnrichment } from "@/lib/track-enrichment";
import { NOW_LISTENING_TAG } from "@/lib/live-events";
import { fanout } from "@api/fanout";
import { homePodListening, patchedListeningEffect } from "@api/stores/telemetry";
import type { PreparedHomePodEvent } from "@shared/ingest/homepod";

export async function commitPreparedHomePodEvent({ stored: incoming }: PreparedHomePodEvent) {
  const previous = await mirror.get();
  const stored = { ...incoming, enrichment: keepEnrichment(incoming.music, incoming.enrichment, previous?.enrichment, true) };
  const layoutChanged = (liveTrack(previous?.music) != null) !== (liveTrack(stored.music) != null);
  const listening = homePodListening(stored);
  await fanout({
    writes: [mirror.put(stored), listening.pulse],
    listening: [listening.effect],
    tags: layoutChanged ? [NOW_LISTENING_TAG] : [],
  });
  return { source: stored.music.source, state: stored.music.state };
}

export async function patchHomePodEnrichment(enrichment: TrackEnrichment): Promise<boolean> {
  const stored = await mirror.get();
  if (!stored || !playableMusic(stored.music) || trackKeyOf(stored.music) !== enrichment.trackKey) return false;
  const merged = mergeEnrichment(stored.enrichment, enrichment, true);
  if (!merged) return false;
  const patched = { ...stored, enrichment: merged };
  await mirror.put(patched);
  await fanout({ listening: [patchedListeningEffect(patched)] });
  return true;
}
