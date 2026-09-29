import { pulseListeningTracesKey } from "@/lib/pulse-keys";
import { PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, tellStorage } from "@/lib/storage";
import { LISTENING_TRACE_CAP, parseListeningTrace, type ListeningTrace } from "@shared/pulse-listening";

/**
 * 追加一次「最近在听」变动：时间线上的不确定区间。和别的时间线写入一样是次要的：
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
