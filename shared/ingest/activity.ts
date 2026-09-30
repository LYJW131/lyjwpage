import { number, object, text } from "@/lib/json";
import type { ActivityHistory, ActivityHistoryBucket, ActivityReport } from "@shared/activity";


const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function amount(value: unknown, field: string): number {
  const parsed = number(value);
  if (parsed == null) throw new Error(`活动上报的 ${field} 必须是数字`);
  if (parsed < 0) throw new Error(`活动上报的 ${field} 不能为负`);
  return parsed;
}

function goal(value: unknown, field: string): number {
  const parsed = amount(value, field);
  if (parsed === 0) throw new Error(`活动上报的 ${field} 必须大于 0`);
  return parsed;
}

function optional(value: unknown): number | null {
  if (value == null) return null;
  const parsed = number(value);
  return parsed == null || parsed < 0 ? null : Math.round(parsed);
}

// 圆环在手表所在时区归零；日期与偏移必须取自同一份 summary，不能用服务器日期补齐。
export function normalizeActivity(
  input: unknown,
  receivedAt = Date.now(),
): ActivityReport {
  const row = object(input);
  if (!row) throw new Error("活动上报必须是 JSON 对象");

  const current = row.date == null ? null : normalizeCurrent(row, receivedAt);
  const history = row.history == null ? null : normalizeHistory(row.history, receivedAt);
  if (!current && !history) throw new Error("活动上报必须包含当前圆环或历史查询");
  return { current, history };
}

function normalizeCurrent(row: Record<string, unknown>, receivedAt: number): ActivityReport["current"] {
  const date = text(row.date);
  if (!date || !DATE_PATTERN.test(date)) throw new Error("活动上报的 date 必须是 YYYY-MM-DD");
  const secondsFromGMT = number(row.secondsFromGMT);
  if (secondsFromGMT == null || Math.abs(secondsFromGMT) > 18 * 3600) {
    throw new Error("活动上报的 secondsFromGMT 必须是秒数，且在 ±18 小时内");
  }
  return {
    activity: {
      date,
      secondsFromGMT,
      moveKcal: Math.round(amount(row.moveKcal, "moveKcal")),
      moveGoalKcal: Math.round(goal(row.moveGoalKcal, "moveGoalKcal")),
      exerciseMinutes: Math.round(amount(row.exerciseMinutes, "exerciseMinutes")),
      exerciseGoalMinutes: Math.round(goal(row.exerciseGoalMinutes, "exerciseGoalMinutes")),
      standHours: Math.round(amount(row.standHours, "standHours")),
      standGoalHours: Math.round(goal(row.standGoalHours, "standGoalHours")),
      steps: optional(row.steps),
      distanceMeters: optional(row.distanceMeters),
      flightsClimbed: optional(row.flightsClimbed),
    },
    receivedAt,
  };
}

const BUCKET_MS = 5 * 60_000;
const MAX_HISTORY_MS = 25 * 60 * 60_000;
const CLOCK_SKEW_MS = 60_000;

// HealthKit 重聚合会抖动末位小数；量化防止每次上报重写整窗历史。
function nullableAmount(value: unknown, decimals: number): number | null {
  if (value == null) return null;
  const parsed = number(value);
  if (parsed == null || parsed < 0) return null;
  const scale = 10 ** decimals;
  return Math.round(parsed * scale) / scale;
}

function normalizeHistory(input: unknown, receivedAt: number): ActivityHistory {
  const history = object(input);
  if (!history) throw new Error("活动上报的 history 必须是 JSON 对象");
  const from = number(history.from);
  const to = number(history.to);
  if (typeof from !== "number" || typeof to !== "number" || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from >= to ||
      from % BUCKET_MS !== 0 || to % BUCKET_MS !== 0 || to - from > MAX_HISTORY_MS || to > receivedAt + CLOCK_SKEW_MS) {
    throw new Error("活动上报的 history 必须是已结束且不超过 25 小时的五分钟对齐范围");
  }
  if (!Array.isArray(history.buckets)) throw new Error("活动上报的 history.buckets 必须是数组");
  const buckets: ActivityHistoryBucket[] = [];
  let previousFrom = -1;
  for (const value of history.buckets) {
    const bucket = object(value);
    if (!bucket) throw new Error("活动上报的历史桶必须是 JSON 对象");
    const bucketFrom = number(bucket.from);
    const bucketTo = number(bucket.to);
    const moveKcal = nullableAmount(bucket.moveKcal, 1);
    const exerciseMinutes = nullableAmount(bucket.exerciseMinutes, 2);
    const steps = nullableAmount(bucket.steps, 0);
    if (typeof bucketFrom !== "number" || !Number.isSafeInteger(bucketFrom) || bucketFrom % BUCKET_MS !== 0 || bucketTo !== bucketFrom + BUCKET_MS ||
        bucketFrom < from || bucketTo > to || bucketFrom <= previousFrom ||
        (moveKcal == null && exerciseMinutes == null && steps == null)) {
      throw new Error("活动上报的历史桶必须有序、唯一、位于查询范围内且至少包含一项统计");
    }
    buckets.push({ from: bucketFrom, to: bucketTo, moveKcal, exerciseMinutes, steps });
    previousFrom = bucketFrom;
  }
  return { from, to, buckets };
}
