import {
  parsePulseSample,
  planPulseSample,
  pulseIntervalRangeKey,
  pulseIntervalRevisionKey,
  pulseKey,
  toPulseSample,
} from "@/lib/pulse";
import { PULSE_HISTORY_LIMIT, PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, tellStorage } from "@/lib/storage";
import type { PulseDomain, PulseLevel } from "@/lib/types";
import type { ActivityHistory } from "@shared/activity";
import { pulseAssessmentsKey } from "@/lib/pulse-assessments";
import { latestPulseAssessments } from "@shared/pulse-assessment";
import { compressPulseWindow } from "@/lib/pulse-window";

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
  next: { t: number; level: PulseLevel; hint?: string | null; until?: number; powerW?: number },
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
      pipe.trim(k, -(domain === "charging" ? 6000 : PULSE_HISTORY_LIMIT), -1);
      pipe.expire(k, PULSE_TTL_MS);
      return pipe.execute();
    });
  } catch (error) {
    console.error("[pulse]", reason(error));
  }
}

/**
 * 用一次 HealthKit 查询结果权威替换范围内的闭合桶。StateHub 的 ingestTail 会把
 * ingest 串行化，所以这里的读、合并、整表替换不会和另一封 iPhone 上报交错。
 */
export async function replacePulseIntervals(
  domain: "activity",
  range: Pick<ActivityHistory, "from" | "to">,
  replacements: { t: number; level: PulseLevel; until: number }[],
): Promise<void> {
  const k = pulseKey(domain);
  const answered = await askStorage(async (storage) => {
    const rows = await storage.batch()
      .listRange(k, 0, -1)
      .listRange(pulseAssessmentsKey(), 0, -1)
      .get(pulseIntervalRevisionKey(domain))
      .execute();
    return { samples: rows[0] as string[], assessments: rows[1] as string[], revision: rows[2] as string | null };
  });
  if (!answered.reachable) return;
  const previous = answered.value.samples.map(parsePulseSample).filter((sample): sample is NonNullable<typeof sample> => sample !== null);
  // 旧的累计估算可能从范围外起步却穿进范围内，不能让它覆盖权威查询中的未知空缺。
  const kept = previous.filter((sample) =>
    (sample.until ?? sample.t) <= range.from || sample.t >= range.to);
  const merged = [...kept, ...replacements.map(toPulseSample)]
    .sort((a, b) => a.t - b.t)
    .slice(-PULSE_HISTORY_LIMIT);
  const nextSamples = replacements.map(toPulseSample);
  const beforeRange = previous.filter((sample) => sample.t < range.to && (sample.until ?? sample.t) > range.from);
  const changed = JSON.stringify(beforeRange) !== JSON.stringify(nextSamples);
  const current = latestPulseAssessments(answered.value.assessments);
  const assessments = current.filter((row) =>
    !changed || row.domain !== domain ||
      JSON.stringify(compressPulseWindow(previous, row).segments) === JSON.stringify(compressPulseWindow(merged, row).segments));
  // 真有评估作废了才重写评估表（顺带压掉重复行）；多数推送只是补上最新一格，还没有评估可作废
  const invalidated = assessments.length !== current.length;
  await tellStorage(async (storage) => {
    const pipe = storage.batch().remove(k);
    if (merged.length) pipe.append(k, ...merged.map((sample) => JSON.stringify(sample)));
    pipe.expire(k, PULSE_TTL_MS);
    pipe.set(pulseIntervalRangeKey(domain), JSON.stringify(range), { ttlMs: PULSE_TTL_MS });
    if (changed) {
      const revision = Number(answered.value.revision);
      pipe.set(pulseIntervalRevisionKey(domain), String(Number.isSafeInteger(revision) ? revision + 1 : 1), { ttlMs: PULSE_TTL_MS });
    }
    if (invalidated) {
      pipe.remove(pulseAssessmentsKey());
      const serialized = assessments.map((row) => JSON.stringify(row));
      for (let at = 0; at < serialized.length; at += 10_000) {
        pipe.append(pulseAssessmentsKey(), ...serialized.slice(at, at + 10_000));
      }
      pipe.expire(pulseAssessmentsKey(), PULSE_TTL_MS);
    }
    return pipe.execute();
  });
}
