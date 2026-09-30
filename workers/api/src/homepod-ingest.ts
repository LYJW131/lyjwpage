import { mirror } from "@shared/homepod-store";
import { liveTrack } from "@/lib/home-layout";
import { NOW_LISTENING_TAG } from "@/lib/live-events";
import { fanout } from "@api/fanout";
import { homePodListening } from "@api/stores/telemetry";
import type { PreparedHomePodEvent } from "@shared/ingest/homepod";

export async function commitPreparedHomePodEvent({ stored }: PreparedHomePodEvent) {
  const previous = await mirror.get();
  const layoutChanged = (liveTrack(previous?.music) != null) !== (liveTrack(stored.music) != null);
  const listening = homePodListening(stored);
  await fanout({
    writes: [mirror.put(stored), listening.pulse],
    listening: [listening.effect],
    tags: layoutChanged ? [NOW_LISTENING_TAG] : [],
  });
  return { source: stored.music.source, state: stored.music.state };
}
