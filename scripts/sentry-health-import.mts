// 一次性：把 Sentry 视图里现有的 30 天日条换成 health_buckets 的小时格，切换当天站点卡片的两条在线条不变空。
// 用法：node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/sentry-health-import.mts --from <sentry.json|URL> --cron-hours <hours.json> --cutover site-uptime=<ms>,core-cron=<ms> --out <file.sql>
// --from 收 `/api/status/sentry` 的响应或 LAG KV 里 `sentry:v1` 的原值（两者都是 `{ data }` 包着载荷）；站点切换后那个端点没了，就读 KV。
// --cron-hours 收 Sentry `api-minute-cron` 的小时统计（monitor stats 接口 resolution=1h 的条目 `{ ts, ok, error, missed, timeout }`，ts 为秒），
// 按整天给：Sentry 11 丢结束签到的那几天，加上切换当天；这几天的心跳按小时重建，timeout 记成跑了。
// --cutover 是各序列新链路的第一次检查（D1 里 `SELECT series, MIN(first_at) FROM health_buckets GROUP BY series`）：只导入它之前的检查，
// 切换那一小时里新链路之前的几分钟由 Sentry 补上。D1 还是空表时不给。
// 只生成 SQL、不连生产；写库由人执行：pnpm --dir workers/core exec wrangler d1 execute lyjwpage-history --remote -c wrangler.toml --file <file.sql>
// 已有的格子只在它的第一次检查晚于导入格的最后一次检查时合并（就是切换那一小时），其余跳过，重复执行也不会重复计数。
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
// 排定次数装不下的多出来的检查（重复执行）塞进最后一格，整天的总数才和 Sentry 对得上；没过完的那天多出来的是截止点之后的，丢掉。
export function daysToBuckets(series: HealthSeriesSpec, days: readonly UptimeDay[], until: number): HealthBucket[] {
  const buckets: HealthBucket[] = [];
  const firstDay = days.find((day) => day.success + day.failure > 0)?.dayStart;
  for (const day of days) {
    const recorded = day.success + day.failure;
    if (recorded === 0) continue;
    const backwards = day.dayStart === firstDay;
    const hours: number[] = [];
    for (let hourStart = day.dayStart; hourStart < day.dayStart + DAY_MS && hourStart <= until; hourStart += HEALTH_BUCKET_MS) hours.push(hourStart);
    if (backwards) hours.reverse();
    const fills = new Map<number, number>();
    let left = recorded;
    for (const hourStart of hours) {
      const take = Math.min(left, scheduledMinutes(series, hourStart, until).length);
      if (take > 0) fills.set(hourStart, take);
      left -= take;
    }
    const last = hours.findLast((hourStart) => fills.has(hourStart)) ?? hours[0];
    if (left > 0 && day.dayStart + DAY_MS <= until && last !== undefined) fills.set(last, (fills.get(last) ?? 0) + left);
    const kept = [...fills.values()].reduce((sum, count) => sum + count, 0);
    const dayFailure = Math.round((day.failure * kept) / recorded);
    let seen = 0;
    let failed = 0;
    for (const hourStart of [...fills.keys()].sort((a, b) => a - b)) {
      const count = fills.get(hourStart)!;
      seen += count;
      const failure = Math.round((dayFailure * seen) / kept) - failed;
      failed += failure;
      const minutes = scheduledMinutes(series, hourStart, until);
      const used = Math.min(count, minutes.length);
      const slots = backwards ? minutes.slice(minutes.length - used) : minutes.slice(0, used);
      buckets.push({
        hourStart,
        success: count - failure,
        failure,
        firstAt: hourStart + (slots[0] ?? 0) * 60_000,
        lastAt: hourStart + (slots.at(-1) ?? 0) * 60_000,
        lastOk: count > failure,
      });
    }
  }
  return buckets;
}

// Sentry 11 的 withMonitor 丢结束签到：开始签到到了、结束签到没到，Sentry 记成 timeout，那一轮其实跑了。
// 所以 timeout 记成功，只有 missed 与 error 是真失败（cron 真停跑时一次签到都没有，Sentry 记的是 missed）。
// 切换之后旧链路不再签到，Sentry 把之后的每一轮都记成 missed：截止点那一小时减掉截止点之后的排定次数，之后的小时不要。
export function cronHoursToBuckets(series: HealthSeriesSpec, hours: readonly CronHour[], until: number): HealthBucket[] {
  return hours.flatMap((hour) => {
    const hourStart = hour.ts * 1000;
    if (hourStart > until) return [];
    const minutes = scheduledMinutes(series, hourStart, until);
    const after = scheduledMinutes(series, hourStart, hourStart + HEALTH_BUCKET_MS - 1).length - minutes.length;
    const success = hour.ok + hour.timeout;
    const failure = Math.max(0, hour.error + hour.missed - after);
    if (success + failure === 0) return [];
    return [{
      hourStart,
      success,
      failure,
      firstAt: hourStart + (minutes[0] ?? 0) * 60_000,
      lastAt: hourStart + (minutes.at(-1) ?? 0) * 60_000,
      lastOk: success > failure,
    }];
  });
}

// 小时统计覆盖的那几天：先核对它和 Sentry 日条是同一份数据（过完的那几天日总数一致），再换成去掉假失败后的日总数。
export function correctDays(
  series: HealthSeriesSpec,
  days: readonly UptimeDay[],
  hours: readonly CronHour[],
  viewUntil: number,
  until: number,
): { days: UptimeDay[]; covered: Set<number>; problems: string[] } {
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
    if (day.dayStart + DAY_MS <= viewUntil && (sum((h) => h.ok) !== day.success || sum((h) => h.error + h.missed + h.timeout) !== day.failure)) {
      problems.push(`${label}: 日条 ${day.success}/${day.failure}，小时统计 ${sum((h) => h.ok)}/${sum((h) => h.error + h.missed + h.timeout)}`);
    }
    const buckets = cronHoursToBuckets(series, dayHours, until);
    return {
      ...day,
      success: buckets.reduce((total, b) => total + b.success, 0),
      failure: buckets.reduce((total, b) => total + b.failure, 0),
    };
  });
  for (const dayStart of byDay.keys()) {
    if (!days.some((day) => day.dayStart === dayStart)) problems.push(`${new Date(dayStart).toISOString().slice(0, 10)}: 日条里没有这一天`);
  }
  return { days: corrected, covered: new Set(byDay.keys()), problems };
}

// 自检：换出来的小时格再按站点的口径汇总回日条，截止点前过完的每一天要和（去掉假失败后的）Sentry 日总数一致。
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

const D1_STATEMENT_MAX_BYTES = 100_000;

export function sql(series: HealthSeriesSpec, buckets: readonly HealthBucket[]): string {
  if (!buckets.length) return "";
  const rows = buckets.map((b) => `('${series.name}', ${b.hourStart}, ${b.success}, ${b.failure}, ${b.firstAt}, ${b.lastAt}, ${b.lastOk ? 1 : 0})`);
  const statement = `INSERT INTO health_buckets(series, hour_start, success, failure, first_at, last_at, last_ok) VALUES
${rows.join(",\n")}
ON CONFLICT(series, hour_start) DO UPDATE SET
  success = health_buckets.success + excluded.success,
  failure = health_buckets.failure + excluded.failure,
  first_at = MIN(health_buckets.first_at, excluded.first_at),
  last_at = MAX(health_buckets.last_at, excluded.last_at),
  last_ok = CASE WHEN excluded.last_at >= health_buckets.last_at THEN excluded.last_ok ELSE health_buckets.last_ok END
WHERE health_buckets.first_at > excluded.last_at;`;
  if (new TextEncoder().encode(statement).length > D1_STATEMENT_MAX_BYTES) throw new Error(`${series.name} 的 INSERT 超过 D1 单条语句上限`);
  return statement;
}

function parseCutover(value: string | undefined): Map<string, number> {
  const cutover = new Map<string, number>();
  for (const part of value ? value.split(",") : []) {
    const [name, at] = part.split("=");
    const ms = /^\d+$/.test(at ?? "") ? Number(at) : Date.parse(at ?? "");
    if (!name || !Number.isFinite(ms)) throw new Error(`看不懂的 --cutover：${part}`);
    cutover.set(name, ms);
  }
  return cutover;
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
  const cutover = parseCutover(arg("--cutover"));
  const parts: string[] = [];
  const problems: string[] = [];
  for (const key of only) {
    const series = SOURCES[key];
    if (!series) throw new Error(`不认识的 --series：${key}`);
    const start = cutover.get(series.name);
    const until = start === undefined ? view.data.fetchedAt : start - 1;
    if (start === undefined) console.error(`${series.name}: 没给 --cutover；D1 里已有新链路数据时，切换那一小时新链路之前的几分钟会缺数`);
    const hours = key === "heartbeat" ? cronHours : [];
    const fixed = correctDays(series, view.data[key].days, hours, view.data.fetchedAt, until);
    problems.push(...fixed.problems.map((problem) => `${series.name} 小时统计对不上：${problem}`));
    const buckets = [
      ...daysToBuckets(series, view.data[key].days.filter((day) => !fixed.covered.has(day.dayStart)), until),
      ...cronHoursToBuckets(series, hours, until),
    ].sort((a, b) => a.hourStart - b.hourStart);
    problems.push(...mismatches(series, fixed.days, buckets, Math.min(until, view.data.fetchedAt)));
    parts.push(sql(series, buckets));
    const total = (field: "success" | "failure") => buckets.reduce((sum, b) => sum + b[field], 0);
    const reclassified = hours.reduce((sum, hour) => sum + (hour.ts * 1000 <= until ? hour.timeout : 0), 0);
    console.error(`${series.name}: ${buckets.length} 格，成功 ${total("success")}，失败 ${total("failure")}，截至 ${new Date(until).toISOString()}${reclassified ? `；${reclassified} 次 timeout 记成跑了` : ""}`);
  }
  if (problems.length) throw new Error(`换算与 Sentry 日总数不一致：\n${problems.join("\n")}`);
  fs.writeFileSync(out, `${parts.join("\n")}\n`);
  console.error(`已写 ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
