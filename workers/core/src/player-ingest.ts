import { homePodVisibleAt } from "@shared/homepod-store";
import { mirror, playablePlayer, type StoredPlayer } from "@shared/player-store";
import { liveTrack } from "@shared/home-layout";
import { keepEnrichment, mergeEnrichment, playableMusic, trackKeyOf, type TrackEnrichment } from "@shared/track-enrichment";
import { NOW_LISTENING_TAG } from "@shared/live-events";
import { fanout } from "@core/fanout";
import { patchedListeningEffect, slotListening } from "@core/stores/telemetry";
import type { PreparedPlayerEvents } from "@shared/ingest/player";

// 一格两台机器共用：另一台还在放时，这台的暂停或停下不顶掉它。
function yieldsTo(previous: StoredPlayer | null, incoming: StoredPlayer): boolean {
  const playing = playablePlayer(previous);
  return !!playing && playing.music.state === "playing" && playing.music.source !== incoming.music.source
    && incoming.music.state !== "playing" && homePodVisibleAt(playing, incoming.receivedAt);
}

export async function commitPreparedPlayerEvents({ stored: incoming }: PreparedPlayerEvents) {
  const previous = await mirror.get();
  if (yieldsTo(previous, incoming)) return { source: incoming.music.source, state: incoming.music.state, kept: previous!.music.source };
  const stored = { ...incoming, enrichment: keepEnrichment(incoming.music, incoming.enrichment, previous?.enrichment, true) };
  const layoutChanged = (liveTrack(previous?.music) != null) !== (liveTrack(stored.music) != null);
  const listening = slotListening(stored.receivedAt, { player: stored });
  await fanout({
    writes: [mirror.put(stored), listening.pulse],
    listening: [listening.effect],
    tags: layoutChanged ? [NOW_LISTENING_TAG] : [],
  });
  return { source: stored.music.source, state: stored.music.state };
}

export async function patchPlayerEnrichment(enrichment: TrackEnrichment): Promise<boolean> {
  const stored = await mirror.get();
  if (!stored || !playableMusic(stored.music) || trackKeyOf(stored.music) !== enrichment.trackKey) return false;
  const merged = mergeEnrichment(stored.enrichment, enrichment, true);
  if (!merged) return false;
  const patched = { ...stored, enrichment: merged };
  await mirror.put(patched);
  await fanout({ listening: [patchedListeningEffect({ player: patched })] });
  return true;
}
