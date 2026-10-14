// 一次性：把 Sentry 视图里现有的 30 天日条换成 health_buckets 的小时格，切换当天站点卡片的两条在线条不变空。
// 用法：node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/sentry-health-import.mts --from <sentry.json|URL> --cron-hours <hours.json> --out <file.sql>
// --from 收 `/api/status/sentry` 的响应或 LAG KV 里 `sentry:v1` 的原值（两者都是 `{ data }` 包着载荷）；站点切换后那个端点没了，就读 KV。
// --cron-hours 收 Sentry `api-minute-cron` 的小时统计（monitor stats 接口 resolution=1h 的条目 `{ ts, ok, error, missed, timeout }`，ts 为秒），
// 只给 Sentry 11 丢结束签到的那几天，按整天给；这几天的心跳按小时重建，timeout 记成跑了。
// 只生成 SQL、不连生产；写库由人执行：pnpm --dir workers/core exec wrangler d1 execute lyjwpage-history --remote -c wrangler.toml --file <file.sql>
// 每个序列只写 D1 里该序列第一格之前的小时：新链路已在记的那一小时及以后只留新链路的数据，重复执行也不会重复计数。
import fs from "node:fs";

import {
  HEALTH_BUCKET_MS,
  HEARTBEAT_SERIES,
  UPTIME_SERIES,
  summarizeBuckets,
  type HealthBucket,
  type HealthSeriesSpec,
} from "@shared/health";
import type { UptimeDay } from "@shared/health-types";

const DAY_MS = 24 * HEALTH_BUCKET_MS;
const SOURCES = { uptime: UPTIME_SERIES, heartbeat: HEARTBEAT_SERIES } as const;

type SentryView = { data: { fetchedAt: number } & Record<keyof typeof SOURCES, { days: UptimeDay[] }> };
export type CronHour = { ts: number; ok: number; error: number; missed: number; timeout: number };

function scheduledMinutes(series: HealthSeriesSpec, hourStart: number, until: number): number[] {
  const minutes: number[] = [];
  for (let minute = 0; minute < 60; minute++) {
    if ((minute - series.offsetMinutes) % series.everyMinutes !== 0) continue;
    if (hourStart + minute * 60_000 <= until) minutes.push(minute);
  }
  return minutes;
}

// Sentry 只给日总数：按排定次数把一天的检查摊进各小时，失败按比例跟着摊。
// 有数据的第一天从当天最后一小时往前填（Sentry 是那天中途开始记的），其余各天从零点往后填。
export function daysToBuckets(series: HealthSeriesSpec, days: readonly UptimeDay[], until: number): HealthBucket[] {
  const buckets: HealthBucket[] = [];
  const firstDay = days.find((day) => day.success + day.failure > 0)?.dayStart;
  for (const day of days) {
    const recorded = day.success + day.failure;
    if (recorded === 0) continue;
    const hours: number[] = [];
    for (let hourStart = day.dayStart; hourStart < day.dayStart + DAY_MS && hourStart <= until; hourStart += HEALTH_BUCKET_MS) hours.push(hourStart);
    if (day.dayStart === firstDay) hours.reverse();
    const fills = new Map<number, number>();
    let left = recorded;
    for (const hourStart of hours) {
      const take = Math.min(left, scheduledMinutes(series, hourStart, until).length);
      if (take > 0) fills.set(hourStart, take);
      left -= take;
    }
    const last = hours.findLast((hourStart) => fills.has(hourStart)) ?? hours[0];
    if (left > 0) fills.set(last, (fills.get(last) ?? 0) + left);
    let seen = 0;
    let failed = 0;
    for (const hourStart of [...fills.keys()].sort((a, b) => a - b)) {
      const count = fills.get(hourStart)!;
      seen += count;
      const failure = Math.round((day.failure * seen) / recorded) - failed;
      failed += failure;
      const minutes = scheduledMinutes(series, hourStart, until);
      const lastMinute = minutes[Math.min(count, minutes.length) - 1] ?? minutes.at(-1) ?? 0;
      buckets.push({ hourStart, success: count - failure, failure, lastAt: hourStart + lastMinute * 60_000, lastOk: count > failure });
    }
  }
  return buckets;
}

// Sentry 11 的 withMonitor 丢结束签到：开始签到到了、结束签到没到，Sentry 记成 timeout，那一轮其实跑了。
// 所以 timeout 记成功，只有 missed 与 error 是真失败（cron 真停跑时一次签到都没有，Sentry 记的是 missed）。
export function cronHoursToBuckets(series: HealthSeriesSpec, hours: readonly CronHour[], until: number): HealthBucket[] {
  return hours.flatMap((hour) => {
    const hourStart = hour.ts * 1000;
    const success = hour.ok + hour.timeout;
    const failure = hour.error + hour.missed;
    if (success + failure === 0) return [];
    const lastMinute = scheduledMinutes(series, hourStart, until).at(-1) ?? 0;
    return [{ hourStart, success, failure, lastAt: hourStart + lastMinute * 60_000, lastOk: success > failure }];
  });
}

// 小时统计覆盖的那几天：先核对它和 Sentry 日条是同一份数据（日总数一致），再换成去掉假失败后的日总数。
export function correctDays(days: readonly UptimeDay[], hours: readonly CronHour[]): { days: UptimeDay[]; covered: Set<number>; problems: string[] } {
  const byDay = new Map<number, CronHour[]>();
  for (const hour of hours) {
    const dayStart = Math.floor((hour.ts * 1000) / DAY_MS) * DAY_MS;
    byDay.set(dayStart, [...(byDay.get(dayStart) ?? []), hour]);
  }
  const problems: string[] = [];
  const corrected = days.map((day) => {
    const dayHours = byDay.get(day.dayStart);
    if (!dayHours) return day;
    const sum = (pick: (hour: CronHour) => number) => dayHours.reduce((total, hour) => total + pick(hour), 0);
    const label = new Date(day.dayStart).toISOString().slice(0, 10);
    if (sum((h) => h.ok) !== day.success || sum((h) => h.error + h.missed + h.timeout) !== day.failure) {
      problems.push(`${label}: 日条 ${day.success}/${day.failure}，小时统计 ${sum((h) => h.ok)}/${sum((h) => h.error + h.missed + h.timeout)}`);
    }
    return { ...day, success: sum((h) => h.ok + h.timeout), failure: sum((h) => h.error + h.missed) };
  });
  for (const dayStart of byDay.keys()) {
    if (!days.some((day) => day.dayStart === dayStart)) problems.push(`${new Date(dayStart).toISOString().slice(0, 10)}: 日条里没有这一天`);
  }
  return { days: corrected, covered: new Set(byDay.keys()), problems };
}

// 自检：换出来的小时格再按站点的口径汇总回日条，切换前的每个整天要和 Sentry 的日总数一致。
export function mismatches(series: HealthSeriesSpec, days: readonly UptimeDay[], buckets: readonly HealthBucket[], until: number): string[] {
  const summary = summarizeBuckets(series, buckets, until);
  const byDay = new Map(summary.days.map((day) => [day.dayStart, day]));
  const problems: string[] = [];
  for (const day of days) {
    if (day.dayStart + DAY_MS > until || day.success + day.failure === 0) continue;
    const got = byDay.get(day.dayStart);
    if (!got || got.success !== day.success || got.failure !== day.failure) {
      problems.push(`${series.name} ${new Date(day.dayStart).toISOString().slice(0, 10)}: Sentry ${day.success}/${day.failure}, 换算后 ${got?.success}/${got?.failure}`);
    }
  }
  return problems;
}

// D1 单条语句上限 100 KB；截止点是语句里的不相关子查询，SQLite 只求一次值，所以一个序列的全部小时放进同一条 INSERT，
// 拆成几条的话，前一条写进去的旧小时会把后一条的截止点往前挪。
const D1_STATEMENT_MAX_BYTES = 100_000;

function sql(series: HealthSeriesSpec, buckets: readonly HealthBucket[]): string {
  if (!buckets.length) return "";
  const rows = buckets.map((b) => `('${series.name}', ${b.hourStart}, ${b.success}, ${b.failure}, ${b.lastAt}, ${b.lastOk ? 1 : 0})`);
  const statement = `INSERT INTO health_buckets(series, hour_start, success, failure, last_at, last_ok)
SELECT column1, column2, column3, column4, column5, column6 FROM (VALUES
${rows.join(",\n")}
)
WHERE column2 < COALESCE((SELECT MIN(hour_start) FROM health_buckets WHERE series = '${series.name}'), ${Number.MAX_SAFE_INTEGER})
ON CONFLICT(series, hour_start) DO NOTHING;`;
  if (new TextEncoder().encode(statement).length > D1_STATEMENT_MAX_BYTES) throw new Error(`${series.name} 的 INSERT 超过 D1 单条语句上限`);
  return statement;
}

async function main(argv: string[]): Promise<void> {
  const arg = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const from = arg("--from") ?? "https://lyjw.me/api/status/sentry";
  const out = arg("--out");
  if (!out) throw new Error("缺 --out <file.sql>");
  const only = (arg("--series") ?? "uptime,heartbeat").split(",") as (keyof typeof SOURCES)[];
  const view = (/^https?:/.test(from) ? await (await fetch(from)).json() : JSON.parse(fs.readFileSync(from, "utf8"))) as SentryView;
  const cronHoursPath = arg("--cron-hours");
  const cronHours = cronHoursPath ? (JSON.parse(fs.readFileSync(cronHoursPath, "utf8")) as CronHour[]) : [];
  const until = view.data.fetchedAt;
  const parts: string[] = [];
  const problems: string[] = [];
  for (const key of only) {
    const series = SOURCES[key];
    if (!series) throw new Error(`不认识的 --series：${key}`);
    const hours = key === "heartbeat" ? cronHours : [];
    const fixed = correctDays(view.data[key].days, hours);
    problems.push(...fixed.problems.map((problem) => `${series.name} 小时统计对不上：${problem}`));
    const buckets = [
      ...daysToBuckets(series, view.data[key].days.filter((day) => !fixed.covered.has(day.dayStart)), until),
      ...cronHoursToBuckets(series, hours, until),
    ].sort((a, b) => a.hourStart - b.hourStart);
    problems.push(...mismatches(series, fixed.days, buckets, until));
    parts.push(sql(series, buckets));
    const total = (field: "success" | "failure") => buckets.reduce((sum, b) => sum + b[field], 0);
    const reclassified = hours.reduce((sum, hour) => sum + hour.timeout, 0);
    console.error(`${series.name}: ${buckets.length} 格，成功 ${total("success")}，失败 ${total("failure")}，截至 ${new Date(until).toISOString()}${reclassified ? `；${reclassified} 次 timeout 记成跑了` : ""}`);
  }
  if (problems.length) throw new Error(`换算与 Sentry 日总数不一致：\n${problems.join("\n")}`);
  fs.writeFileSync(out, `${parts.join("\n")}\n`);
  console.error(`已写 ${out}；D1 里已有新链路数据的那一小时及以后不导入。`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
