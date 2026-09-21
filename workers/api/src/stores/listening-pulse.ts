import { listeningPlaysKey } from "@/lib/listening-pulse";
import { PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, tellStorage } from "@/lib/storage";
import { parseListeningPlay, type ListeningPlay } from "@shared/pulse-listening";

/**
 * 追加一次「最近在听」变动。和 coding 观测同一套：证据是次要的，读不到 SQLite
 * 就当没发生，失败只打日志 —— 一轮刷新不能因为它变成 500。
 */
export async function recordListeningPlay(play: ListeningPlay): Promise<void> {
  try {
    const k = listeningPlaysKey();
    const answer = await askStorage((storage) => storage.listRange(k, -1, -1));
    if (!answer.reachable) return;
    const last = answer.value[0] ? parseListeningPlay(answer.value[0]) : null;
    // 闸门保证同一窗口只有一个实例在拉，`t` 不前进就是重放或乱序。
    if (last && play.t <= last.t) return;
    await tellStorage((storage) =>
      storage.batch().append(k, JSON.stringify(play)).trim(k, -2000, -1).expire(k, PULSE_TTL_MS).execute(),
    );
  } catch (error) {
    console.error("[pulse-listening-play]", error instanceof Error ? error.message : String(error));
  }
}
