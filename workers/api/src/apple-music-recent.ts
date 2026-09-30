import { withStorageScope } from "@/lib/storage";
import type { ListeningItem, RecentTrack } from "@/lib/types";
import { fanout } from "@api/fanout";
import { prepareRecentlyPlayed } from "@api/stores/apple-music-store";
import { prepareRecentTracks, recordListeningTrace } from "@api/stores/listening-pulse";

export async function commitRecentlyPlayed(items: ListeningItem[]): Promise<{ changed: boolean }> {
  return withStorageScope(async () => {
    const { changed, listening, commit } = await prepareRecentlyPlayed(items);
    await fanout({
      writes: [commit()],
      events: changed ? [{ type: "listening", payload: listening }] : [],
    });
    return { changed };
  });
}

export async function commitRecentTracks(tracks: RecentTrack[]): Promise<{ traced: boolean }> {
  return withStorageScope(async () => {
    const { trace, commit } = await prepareRecentTracks(tracks);
    await fanout({ writes: trace ? [commit(), recordListeningTrace(trace)] : [commit()] });
    return { traced: trace !== null };
  });
}
