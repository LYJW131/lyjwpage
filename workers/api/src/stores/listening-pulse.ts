import { pulseListeningTracesKey } from "@/lib/pulse-keys";
import { PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, mirrorKey, tellStorage } from "@/lib/storage";
import type { RecentTrack } from "@/lib/types";
import { LISTENING_TRACE_CAP, listeningTrace, parseListeningTrace, type ListeningTrace } from "@shared/pulse-listening";

/**
 * 上一轮拉到的最近播放单曲，只作下一轮比较的基线，不对外读。
 * 键里带格式版本，改值的形状要一起升（同 shared/apple-music-store 的 mirror）。
 */
const recentTracks = mirrorKey<{ tracks: RecentTrack[]; fetchedAt: number }>(
  ["apple-music", "recent-tracks", "v1"],
  (state) => state.fetchedAt,
);

/** 收下一份最近播放单曲：与基线比出痕迹，写留给 commit。 */
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

/**
 * 追加一次「最近播放的歌」变动：时间线上的不确定区间。和别的时间线写入一样是次要的：
 * 读不到 SQLite 就当没发生，失败只打日志 —— 一轮刷新不能因为它变成 500。
 */
export async function recordListeningTrace(trace: ListeningTrace): Promise<void> {
  try {
    const k = pulseListeningTracesKey();
    const answer = await askStorage((storage) => storage.listRange(k, -1, -1));
    if (!answer.reachable) return;
    const last = answer.value[0] ? parseListeningTrace(answer.value[0]) : null;
    // `t` 不前进就是重放或乱序，丢掉；采集没有互斥，不指望上游只送来一份。
    if (last && trace.t <= last.t) return;
    await tellStorage((storage) =>
      storage.batch().append(k, JSON.stringify(trace)).trim(k, -LISTENING_TRACE_CAP, -1).expire(k, PULSE_TTL_MS).execute(),
    );
  } catch (error) {
    console.error("[pulse-listening-trace]", error instanceof Error ? error.message : String(error));
  }
}
