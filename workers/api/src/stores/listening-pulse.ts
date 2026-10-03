import { pulseListeningTracesKey } from "@/lib/pulse-keys";
import { PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, mirrorKey, tellStorage } from "@/lib/storage";
import type { RecentTrack } from "@/lib/types";
import { LISTENING_TRACE_CAP, listeningTraces, parseListeningTrace, type ListeningTrace, type RecentTracksSnapshot } from "@shared/pulse-listening";

const recentTracks = mirrorKey<RecentTracksSnapshot>(
  ["apple-music", "recent-tracks", "v1"],
  (state) => state.fetchedAt,
);

// 窗口要用拿到列表的时刻：采集 Worker 先交专辑列表再交这份，到这里已晚了好几秒，用收到的时刻会把真实开播排除在窗口外。
const OBSERVED_AT_MAX_AGE_MS = 2 * 60_000;

export async function prepareRecentTracks(
  tracks: RecentTrack[],
  observedAt?: number,
  now = Date.now(),
): Promise<{ traces: ListeningTrace[]; commit: () => Promise<void> }> {
  const fetchedAt = typeof observedAt === "number" && Number.isSafeInteger(observedAt) && observedAt <= now && now - observedAt <= OBSERVED_AT_MAX_AGE_MS
    ? observedAt
    : now;
  const next = { tracks, fetchedAt };
  const { traces, keep } = listeningTraces(await recentTracks.get(), next);
  return { traces, commit: keep ? () => recentTracks.put(next) : async () => {} };
}

export async function recordListeningTraces(traces: ListeningTrace[]): Promise<void> {
  if (!traces.length) return;
  try {
    const k = pulseListeningTracesKey();
    const answer = await askStorage((storage) => storage.listRange(k, -1, -1));
    if (!answer.reachable) return;
    const last = answer.value[0] ? parseListeningTrace(answer.value[0]) : null;
    if (last && traces[0].t <= last.t) return;
    await tellStorage((storage) =>
      storage.batch().append(k, ...traces.map((trace) => JSON.stringify(trace))).trim(k, -LISTENING_TRACE_CAP, -1).expire(k, PULSE_TTL_MS).execute(),
    );
  } catch (error) {
    console.error("[pulse-listening-trace]", error instanceof Error ? error.message : String(error));
  }
}
