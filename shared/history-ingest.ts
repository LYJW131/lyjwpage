/**
 * 上报侧的长期归档（D1 `lyjwpage-history`，表见 workers/api/migrations/0005）。
 *
 * 谁写入谁归档：训练、每日圆环、限额快照、服务器小时汇总都由收下这封上报的一方
 * 顺手写入，不另设搬运流程。这里只拼语句，不碰 SQLite、不碰 fetch：调用方在
 * 收下这封上报之后把整批交给 `db.batch`，失败只记日志，不能让已收下的上报重发。
 *
 * 训练、每日圆环、限额快照按自然键 upsert：同一封重试两次、或者两封乱序到达，留下的都是
 * 收到时刻最晚的那份，不产生重复行。服务器小时汇总是累加，靠观测时刻只进不退挡重放，
 * 口径见 `serverHourStatements`。
 */

import type { ActivityReport } from "@shared/activity";
import type { ParsedAgentLimits } from "@/lib/agent-limits-parse";
import type { ServerStatus, WorkoutsPayload } from "@/lib/types";

/** D1 的最小子集；测试用 node:sqlite 包一层同形的替身 */
export interface HistoryStatement {
  bind(...values: unknown[]): HistoryStatement;
}
export interface HistoryDb {
  prepare(sql: string): HistoryStatement;
  batch(statements: HistoryStatement[]): Promise<unknown>;
}

/** 限额按站点统计日分天，和 AI Coding 的用量日桶同一个时区 */
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

/** 最近的训练（条数上限 `WORKOUT_LIMIT`）每封都整份重发；没变的行不改写，所以只有新增或修订的训练产生 D1 写入 */
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

/** 圆环只在涨，一天里最后一封就是终值；只带历史桶、没有当前圆环的那封不写这张表 */
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

/** 取不到的那行（空 limits + limitsError）不写：快照记的是读数，不是「这次没读到」 */
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

/**
 * 按观测时刻所在的 UTC 整点累加。`WHERE` 只放行观测时刻晚于该小时 `last_observed_at` 的样本：
 * 上报器重试同一封、或别的样本夹在中间之后再重放（A→B→A），都不会把已累加的样本再加一次；
 * 「末值」类的列（流量、运行时长）也因此总是取观测最晚的那份。
 *
 * 代价：乱序晚到的旧样本也被挡掉，因为它和重放分不开，分开就得逐条记账。上报器按分钟顺序推送，
 * 丢一个样本只让在线分钟数少一，均值（和 / 样本数）不受影响。
 */
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
