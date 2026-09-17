import {
  parsePulseSample,
  planPulseSample,
  pulseKey,
} from "@/lib/pulse";
import { PULSE_HISTORY_LIMIT, PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, tellStorage } from "@/lib/storage";
import type { PulseDomain, PulseLevel } from "@/lib/types";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 往一个域的 pulse 序列上追加一笔。序列是次要的：失败只打日志，不能让主状态上报 500。
 *
 * 读最后一条 → 规划 → 有样本才在同一批里 append + trim + expire。
 */
export async function recordPulse(
  domain: PulseDomain,
  next: { t: number; level: PulseLevel; hint?: string | null },
): Promise<void> {
  try {
    const k = pulseKey(domain);
    const answered = await askStorage((storage) => storage.listRange(k, -1, -1));
    if (!answered.reachable) return;
    const last = answered.value[0] ? parsePulseSample(answered.value[0]) : null;
    const sample = planPulseSample(last, next);
    if (!sample) return;
    await tellStorage(async (storage) => {
      const pipe = storage.batch();
      pipe.append(k, JSON.stringify(sample));
      pipe.trim(k, -PULSE_HISTORY_LIMIT, -1);
      pipe.expire(k, PULSE_TTL_MS);
      return pipe.execute();
    });
  } catch (error) {
    console.error("[pulse]", reason(error));
  }
}
