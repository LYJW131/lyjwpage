// 一次性：把 Sentry 视图里现有的 30 天日条换成 health_buckets 的小时格，切换当天站点卡片的两条在线条不变空。
// 用法：node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/sentry-health-import.mts --from <sentry.json|URL> --out <file.sql>
// --from 收 `/api/status/sentry` 的响应或 LAG KV 里 `sentry:v1` 的原值（两者都是 `{ data }` 包着载荷）；站点切换后那个端点没了，就读 KV。
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
  const until = view.data.fetchedAt;
  const parts: string[] = [];
  const problems: string[] = [];
  for (const key of only) {
    const series = SOURCES[key];
    if (!series) throw new Error(`不认识的 --series：${key}`);
    const buckets = daysToBuckets(series, view.data[key].days, until);
    problems.push(...mismatches(series, view.data[key].days, buckets, until));
    parts.push(sql(series, buckets));
    const total = (field: "success" | "failure") => buckets.reduce((sum, b) => sum + b[field], 0);
    console.error(`${series.name}: ${buckets.length} 格，成功 ${total("success")}，失败 ${total("failure")}，截至 ${new Date(until).toISOString()}`);
  }
  if (problems.length) throw new Error(`换算与 Sentry 日总数不一致：\n${problems.join("\n")}`);
  fs.writeFileSync(out, `${parts.join("\n")}\n`);
  console.error(`已写 ${out}；D1 里已有新链路数据的那一小时及以后不导入。`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
