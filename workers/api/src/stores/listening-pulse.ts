import { pulseListeningTracesKey } from "@/lib/pulse-keys";
import { PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, mirrorKey, tellStorage } from "@/lib/storage";
import type { RecentTrack } from "@/lib/types";
import { LISTENING_TRACE_CAP, listeningTrace, parseListeningTrace, type ListeningTrace } from "@shared/pulse-listening";

const recentTracks = mirrorKey<{ tracks: RecentTrack[]; fetchedAt: number }>(
  ["apple-music", "recent-tracks", "v1"],
  (state) => state.fetchedAt,
);

export async function prepareRecentTracks(
  tracks: RecentTrack[],
  fetchedAt = Date.now(),
): Promise<{ trace: ListeningTrace | null; commit: () => Promise<void> }> {
  const previous = await recentTracks.get();
  return {
    trace: listeningTrace(previous, { tracks, fetchedAt }),
    commit: () => recentTracks.put({ tracks, fetchedAt }),
  };
}

export async function recordListeningTrace(trace: ListeningTrace): Promise<void> {
  try {
    const k = pulseListeningTracesKey();
    const answer = await askStorage((storage) => storage.listRange(k, -1, -1));
    if (!answer.reachable) return;
    const last = answer.value[0] ? parseListeningTrace(answer.value[0]) : null;
    if (last && trace.t <= last.t) return;
    await tellStorage((storage) =>
      storage.batch().append(k, JSON.stringify(trace)).trim(k, -LISTENING_TRACE_CAP, -1).expire(k, PULSE_TTL_MS).execute(),
    );
  } catch (error) {
    console.error("[pulse-listening-trace]", error instanceof Error ? error.message : String(error));
  }
}
