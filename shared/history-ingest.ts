import type { ActivityReport } from "@shared/activity";
import type { ParsedAgentLimits } from "@/lib/agent-limits-parse";
import type { ServerStatus, WorkoutsPayload } from "@/lib/types";

export interface HistoryStatement {
  bind(...values: unknown[]): HistoryStatement;
}
export interface HistoryDb {
  prepare(sql: string): HistoryStatement;
  batch(statements: HistoryStatement[]): Promise<unknown>;
}

const SITE_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function siteDay(at: number): string {
  return SITE_DAY.format(new Date(at));
}

const HOUR_MS = 60 * 60 * 1000;

const UPSERT_WORKOUT = `INSERT INTO workouts(id, activity_type, started_at, ended_at, seconds_from_gmt, duration_s,
    distance_m, energy_kcal, avg_hr_bpm, max_hr_bpm, elevation_m, indoor, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET activity_type = excluded.activity_type, started_at = excluded.started_at,
    ended_at = excluded.ended_at, seconds_from_gmt = excluded.seconds_from_gmt, duration_s = excluded.duration_s,
    distance_m = excluded.distance_m, energy_kcal = excluded.energy_kcal, avg_hr_bpm = excluded.avg_hr_bpm,
    max_hr_bpm = excluded.max_hr_bpm, elevation_m = excluded.elevation_m, indoor = excluded.indoor,
    received_at = excluded.received_at
  WHERE excluded.received_at >= workouts.received_at`;

export function workoutStatements(db: HistoryDb, payload: WorkoutsPayload): HistoryStatement[] {
  return payload.items.map((item) => db.prepare(UPSERT_WORKOUT).bind(
    item.id,
    item.activityType,
    item.startedAt,
    item.endedAt,
    item.secondsFromGMT,
    item.durationSeconds,
    item.distanceMeters,
    item.activeEnergyKcal,
    item.averageHeartRateBpm,
    item.maximumHeartRateBpm,
    item.elevationAscendedMeters,
    item.indoor == null ? null : item.indoor ? 1 : 0,
    payload.pushedAt,
  ));
}

const UPSERT_ACTIVITY_DAY = `INSERT INTO activity_days(date, seconds_from_gmt, move_kcal, move_goal_kcal,
    exercise_minutes, exercise_goal_minutes, stand_hours, stand_goal_hours, steps, distance_m, flights_climbed, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET seconds_from_gmt = excluded.seconds_from_gmt, move_kcal = excluded.move_kcal,
    move_goal_kcal = excluded.move_goal_kcal, exercise_minutes = excluded.exercise_minutes,
    exercise_goal_minutes = excluded.exercise_goal_minutes, stand_hours = excluded.stand_hours,
    stand_goal_hours = excluded.stand_goal_hours, steps = excluded.steps, distance_m = excluded.distance_m,
    flights_climbed = excluded.flights_climbed, received_at = excluded.received_at
  WHERE excluded.received_at >= activity_days.received_at`;

export function activityDayStatements(db: HistoryDb, report: ActivityReport): HistoryStatement[] {
  const current = report.current;
  if (!current) return [];
  const rings = current.activity;
  return [db.prepare(UPSERT_ACTIVITY_DAY).bind(
    rings.date,
    rings.secondsFromGMT,
    rings.moveKcal,
    rings.moveGoalKcal,
    rings.exerciseMinutes,
    rings.exerciseGoalMinutes,
    rings.standHours,
    rings.standGoalHours,
    rings.steps,
    rings.distanceMeters,
    rings.flightsClimbed,
    current.receivedAt,
  )];
}

const UPSERT_LIMIT = `INSERT INTO limit_snapshots(date, agent, limit_key, label, limit_group, window_minutes,
    used_percent, resets_at, plan, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date, agent, limit_key) DO UPDATE SET label = excluded.label, limit_group = excluded.limit_group,
    window_minutes = excluded.window_minutes, used_percent = excluded.used_percent, resets_at = excluded.resets_at,
    plan = excluded.plan, received_at = excluded.received_at
  WHERE excluded.received_at >= limit_snapshots.received_at`;

export function limitStatements(db: HistoryDb, limits: ParsedAgentLimits, receivedAt: number): HistoryStatement[] {
  const date = siteDay(receivedAt);
  return limits.agents.flatMap((row) => row.limits.map((limit) => db.prepare(UPSERT_LIMIT).bind(
    date,
    row.id,
    limit.key,
    limit.label,
    limit.group,
    limit.windowMinutes,
    limit.usedPercent,
    limit.resetsAt,
    row.plan?.tier ?? null,
    receivedAt,
  )));
}

const UPSERT_SERVER_HOUR = `INSERT INTO server_hours(host, hour_at, samples, cpu_percent_sum, cpu_percent_max,
    load1_sum, load1_max, memory_used_bytes_sum, memory_total_bytes, rx_bytes_per_sec_max, tx_bytes_per_sec_max,
    traffic_cycle_start, traffic_rx_bytes, traffic_tx_bytes, uptime_seconds, last_observed_at)
  VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(host, hour_at) DO UPDATE SET samples = samples + 1,
    cpu_percent_sum = cpu_percent_sum + excluded.cpu_percent_sum,
    cpu_percent_max = MAX(cpu_percent_max, excluded.cpu_percent_max),
    load1_sum = load1_sum + excluded.load1_sum,
    load1_max = MAX(load1_max, excluded.load1_max),
    memory_used_bytes_sum = memory_used_bytes_sum + excluded.memory_used_bytes_sum,
    memory_total_bytes = excluded.memory_total_bytes,
    rx_bytes_per_sec_max = MAX(rx_bytes_per_sec_max, excluded.rx_bytes_per_sec_max),
    tx_bytes_per_sec_max = MAX(tx_bytes_per_sec_max, excluded.tx_bytes_per_sec_max),
    traffic_cycle_start = excluded.traffic_cycle_start,
    traffic_rx_bytes = excluded.traffic_rx_bytes,
    traffic_tx_bytes = excluded.traffic_tx_bytes,
    uptime_seconds = excluded.uptime_seconds,
    last_observed_at = excluded.last_observed_at
  WHERE excluded.last_observed_at > server_hours.last_observed_at`;

// 拒绝乱序旧样本是去重的代价：未逐条记账时，无法将旧样本与重放区分。
export function serverHourStatements(db: HistoryDb, status: ServerStatus): HistoryStatement[] {
  const hourAt = Math.floor(status.observedAt / HOUR_MS) * HOUR_MS;
  return [db.prepare(UPSERT_SERVER_HOUR).bind(
    status.hostname,
    hourAt,
    status.cpuUsagePercent,
    status.cpuUsagePercent,
    status.load1,
    status.load1,
    status.memoryUsedBytes,
    status.memoryTotalBytes,
    status.networkRxBytesPerSec,
    status.networkTxBytesPerSec,
    status.traffic?.cycleStart ?? null,
    status.traffic?.rxBytes ?? null,
    status.traffic?.txBytes ?? null,
    Math.round(status.uptimeSeconds),
    status.observedAt,
  )];
}

export async function runHistory(db: HistoryDb, statements: HistoryStatement[]): Promise<void> {
  if (!statements.length) return;
  await db.batch(statements);
}
