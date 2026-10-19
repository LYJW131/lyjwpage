import { site } from "./site.ts";

const NOW_TOKEN = /^\$now([+-]\d+)?$/;
const ISO_TOKEN = /^\$iso([+-]\d+)?$/;
const TODAY_TOKEN = /^\$today([+-]\d+)?$/;

const DAY_MS = 86_400_000;

// 日期偏移必须按日历计算，跨夏令时不等于固定 24 小时。
export function siteDay(now: number, offsetDays: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: site.timezone }).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function dayOffset(now: number, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${siteDay(now, 0)}T00:00:00Z`)) / DAY_MS);
}

// 同一次注入的全部时间令牌必须共用同一个 now，否则成对的视图（摘要与 Pulse）会差出几毫秒到几秒。
export function stampNow(value: unknown, now: number): unknown {
  if (typeof value === "string") {
    const match = NOW_TOKEN.exec(value);
    if (match) return now + Number(match[1] ?? 0);
    const iso = ISO_TOKEN.exec(value);
    if (iso) return new Date(now + Number(iso[1] ?? 0)).toISOString();
    const day = TODAY_TOKEN.exec(value);
    return day ? siteDay(now, Number(day[1] ?? 0)) : value;
  }
  if (Array.isArray(value)) return value.map((item) => stampNow(item, now));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stampNow(item, now)]));
  }
  return value;
}
