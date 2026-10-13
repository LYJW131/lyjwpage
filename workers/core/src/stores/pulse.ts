import {
  pulseActivityKey,
  pulseActivityRangeKey,
  pulseActivityRevisionKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseLaneOpenKey,
  pulseWorkoutsKey,
} from "../pulse-keys";
import { PULSE_TTL_MS } from "@shared/limits";
import { getStorage } from "@shared/storage";
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
  type ObservationHold,
  type StateLane,
  type StateLaneFacts,
  type WorkoutInterval,
} from "@shared/pulse-timeline";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function recordStateObservation<L extends StateLane>(
  lane: L,
  t: number,
  facts: StateLaneFacts[L] | null,
  hold?: ObservationHold,
): Promise<void> {
  try {
    const openKey = pulseLaneOpenKey(lane);
    const storage = getStorage();
    const open = parseOpenInterval(lane, await storage.get(openKey));
    const plan = hold === undefined ? planStateObservation(lane, open, t, facts) : planStateObservation(lane, open, t, facts, hold);
    if (!plan) return;
    const pipe = storage.batch();
    if (plan.closed.length) {
      const listKey = pulseLaneKey(lane);
      pipe.append(listKey, ...plan.closed.map((row) => JSON.stringify(row)));
      pipe.trim(listKey, -STATE_LANE_CAPS[lane], -1);
      pipe.expire(listKey, PULSE_TTL_MS);
    }
    // 明确停播后的空闲持续到下一次播放，过期会把已知空闲误变成未知。
    if (plan.open) pipe.set(openKey, JSON.stringify(plan.open), plan.open.holdUntil === null ? undefined : { ttlMs: PULSE_TTL_MS });
    else pipe.remove(openKey);
    await pipe.execute();
  } catch (error) {
    console.error("[pulse]", lane, reason(error));
  }
}

export async function recordChargingSample(t: number, watts: number, device: string | null): Promise<void> {
  try {
    const k = pulseChargingKey();
    const storage = getStorage();
    const [tail] = await storage.listRange(k, -1, -1);
    const last = tail ? parseChargingSample(tail) : null;
    const sample = planChargingSample(last, { t, watts, device });
    if (!sample) return;
    await storage.batch().append(k, JSON.stringify(sample)).trim(k, -CHARGING_SAMPLE_CAP, -1).expire(k, PULSE_TTL_MS).execute();
  } catch (error) {
    console.error("[pulse]", "charging", reason(error));
  }
}

export async function replacePulseActivity(range: { from: number; to: number }, buckets: ActivityBucket[]): Promise<void> {
  const k = pulseActivityKey();
  const storage = getStorage();
  const rows = await storage.batch().listRange(k, 0, -1).get(pulseActivityRevisionKey()).get(pulseActivityRangeKey()).execute();
  const stored = { rows: rows[0] as string[], revision: rows[1] as string | null, range: rows[2] as string | null };
  const previous = stored.rows.map(parseActivityBucket);
  const clean = previous.every((row) => row !== null);
  const parsed = previous.filter((row): row is ActivityBucket => row !== null);
  const { next, firstChanged, changed } = replaceActivityBuckets(parsed, range, buckets);
  const rangeJson = JSON.stringify({ from: range.from, to: range.to });
  if (!changed && clean && stored.range === rangeJson) return;
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
    const revision = Number(stored.revision);
    pipe.set(pulseActivityRevisionKey(), String(Number.isSafeInteger(revision) ? revision + 1 : 1), { ttlMs: PULSE_TTL_MS });
  }
  await pipe.execute();
}

export async function writePulseWorkouts(items: WorkoutInterval[]): Promise<void> {
  const k = pulseWorkoutsKey();
  const value = JSON.stringify({ items });
  const storage = getStorage();
  if (await storage.get(k) === value) return;
  await storage.set(k, value, { ttlMs: PULSE_TTL_MS });
}
