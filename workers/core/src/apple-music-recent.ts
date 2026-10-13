import type { ListeningItem, PlayingContainer, RecentTrack } from "@shared/types";
import { getNowListening, readRecentListeningTraces } from "./telemetry";
import { fanout } from "@core/fanout";
import { preparePlayingContainer, prepareRecentlyPlayed } from "@core/stores/apple-music-store";
import { prepareRecentTracks, recordListeningTraces } from "@core/stores/listening-pulse";
import { nextTraceBy } from "@shared/pulse-listening";

export async function commitRecentlyPlayed(items: ListeningItem[], container?: PlayingContainer | null): Promise<{ changed: boolean }> {
  const [{ changed, listening, commit }, playing] = await Promise.all([
    prepareRecentlyPlayed(items),
    container === undefined ? null : preparePlayingContainer(container),
  ]);
  await fanout({
    writes: playing?.changed ? [commit(), playing.commit()] : [commit()],
    events: changed ? [{ type: "listening", payload: listening }] : [],
  });
  if (playing?.changed) await fanout({ events: [getNowListening().then((payload) => ({ type: "listening-now" as const, payload }))] });
  return { changed };
}

export async function commitRecentTracks(tracks: RecentTrack[], observedAt?: number): Promise<{ traced: boolean; nextBy?: number }> {
  const { traces, commit } = await prepareRecentTracks(tracks, observedAt);
  await fanout({ writes: traces.length ? [commit(), recordListeningTraces(traces)] : [commit()] });
  if (traces.length) await fanout({ events: [getNowListening().then((payload) => ({ type: "listening-now" as const, payload }))] });
  const nextBy = nextTraceBy(await readRecentListeningTraces(), Date.now());
  return nextBy === null ? { traced: traces.length > 0 } : { traced: traces.length > 0, nextBy };
}
