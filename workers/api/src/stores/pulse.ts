import {
  pulseActivityKey,
  pulseActivityRangeKey,
  pulseActivityRevisionKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseLaneOpenKey,
  pulseWorkoutsKey,
} from "@/lib/pulse-keys";
import { PULSE_TTL_MS } from "@/lib/limits";
import { askStorage, tellStorage } from "@/lib/storage";
import {
  ACTIVITY_BUCKET_CAP,
  CHARGING_SAMPLE_CAP,
  STATE_LANE_CAPS,
  parseActivityBucket,
  parseChargingSample,
  parseOpenInterval,
  planChargingSample,
  planStateObservation,
  replaceActivityBuckets,
  type ActivityBucket,
  type StateLane,
  type StateLaneFacts,
  type WorkoutInterval,
} from "@shared/pulse-timeline";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 一条状态道的一次观测。时间线是次要的：失败只打日志，不能让主状态上报 500。
 *
 * 读开着的那段 → 规划 → 有要写的才在同一批里追加关闭区间、改写或删掉开着那段。
 * `facts` 为 null 表示这一刻看不见这条道，开着那段到此为止。
 */
export async function recordStateObservation<L extends StateLane>(
  lane: L,
  t: number,
  facts: StateLaneFacts[L] | null,
): Promise<void> {
  try {
    const openKey = pulseLaneOpenKey(lane);
    const answered = await askStorage((storage) => storage.get(openKey));
    if (!answered.reachable) return;
    const plan = planStateObservation(lane, parseOpenInterval(lane, answered.value), t, facts);
    if (!plan) return;
    await tellStorage(async (storage) => {
      const pipe = storage.batch();
      if (plan.closed.length) {
        const listKey = pulseLaneKey(lane);
        pipe.append(listKey, ...plan.closed.map((row) => JSON.stringify(row)));
        pipe.trim(listKey, -STATE_LANE_CAPS[lane], -1);
        pipe.expire(listKey, PULSE_TTL_MS);
      }
      if (plan.open) pipe.set(openKey, JSON.stringify(plan.open), { ttlMs: PULSE_TTL_MS });
      else pipe.remove(openKey);
      return pipe.execute();
    });
  } catch (error) {
    console.error("[pulse]", lane, reason(error));
  }
}

/** 充电头的一笔实测瓦数，闸门见 planChargingSample */
export async function recordChargingSample(t: number, watts: number, device: string | null): Promise<void> {
  try {
    const k = pulseChargingKey();
    const answered = await askStorage((storage) => storage.listRange(k, -1, -1));
    if (!answered.reachable) return;
    const last = answered.value[0] ? parseChargingSample(answered.value[0]) : null;
    const sample = planChargingSample(last, { t, watts, device });
    if (!sample) return;
    await tellStorage((storage) =>
      storage.batch().append(k, JSON.stringify(sample)).trim(k, -CHARGING_SAMPLE_CAP, -1).expire(k, PULSE_TTL_MS).execute(),
    );
  } catch (error) {
    console.error("[pulse]", "charging", reason(error));
  }
}

/**
 * 用一次 HealthKit 查询结果权威替换范围内的五分钟桶。StateHub 的 ingestTail 会把
 * ingest 串行化，这里的读、合并、改写不会和另一封 iPhone 上报交错。
 *
 * 只从第一处不同的桶往后重写：每次推送通常只动最后一两个桶，整串 remove + append
 * 会让每封 iPhone 上报写两千行（见 docs/state-storage 里 Workers Paid 用量那条）。
 */
export async function replacePulseActivity(range: { from: number; to: number }, buckets: ActivityBucket[]): Promise<void> {
  const k = pulseActivityKey();
  const answered = await askStorage(async (storage) => {
    const rows = await storage.batch().listRange(k, 0, -1).get(pulseActivityRevisionKey()).get(pulseActivityRangeKey()).execute();
    return { rows: rows[0] as string[], revision: rows[1] as string | null, range: rows[2] as string | null };
  });
  if (!answered.reachable) return;
  const previous = answered.value.rows.map(parseActivityBucket);
  // 有坏行就整串重写，别让下标对不上
  const clean = previous.every((row) => row !== null);
  const parsed = previous.filter((row): row is ActivityBucket => row !== null);
  const { next, firstChanged, changed } = replaceActivityBuckets(parsed, range, buckets);
  const rangeJson = JSON.stringify({ from: range.from, to: range.to });
  if (!changed && clean && answered.value.range === rangeJson) return;
  await tellStorage(async (storage) => {
    const pipe = storage.batch();
    if (changed || !clean) {
      const keep = clean ? firstChanged : 0;
      if (keep === 0) pipe.remove(k);
      else pipe.trim(k, 0, keep - 1);
      const rest = next.slice(keep).map((row) => JSON.stringify(row));
      for (let at = 0; at < rest.length; at += 10_000) pipe.append(k, ...rest.slice(at, at + 10_000));
      pipe.trim(k, -ACTIVITY_BUCKET_CAP, -1);
      pipe.expire(k, PULSE_TTL_MS);
    }
    pipe.set(pulseActivityRangeKey(), rangeJson, { ttlMs: PULSE_TTL_MS });
    if (changed) {
      const revision = Number(answered.value.revision);
      pipe.set(pulseActivityRevisionKey(), String(Number.isSafeInteger(revision) ? revision + 1 : 1), { ttlMs: PULSE_TTL_MS });
    }
    return pipe.execute();
  });
}

/** 训练区间整份替换（HealthKit 里删掉的训练也跟着消失）；内容没变不写 */
export async function writePulseWorkouts(items: WorkoutInterval[]): Promise<void> {
  const k = pulseWorkoutsKey();
  const value = JSON.stringify({ items });
  const answered = await askStorage((storage) => storage.get(k));
  if (answered.reachable && answered.value === value) return;
  await tellStorage((storage) => storage.set(k, value, { ttlMs: PULSE_TTL_MS }));
}
