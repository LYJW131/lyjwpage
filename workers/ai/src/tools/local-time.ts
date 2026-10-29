import { site } from "@shared/site";

export const STATUS_TIME_ZONE = site.timezone;
const LOCAL_TIME = new Intl.DateTimeFormat("sv-SE", { timeZone: STATUS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const localTime = (ms: number) => LOCAL_TIME.format(ms);

// 模型自己换算 epoch 毫秒常把日期、甚至年份算错，所以时间点字段直接给本地时间；时长字段（…Ms）照旧是毫秒。
// 「昨天」「今天」也由这里按本地日历日算好附在后面：模型自己比日期会把昨天 02:28 说成「昨晚」甚至「今天凌晨」。
// resetsAt 是 Unix 秒，Emby 的 playedAt 是 ISO 字符串，pulse 的 window.from / to 与 PageSpeed 的 start 不带 At 后缀。
const TIME_KEY = /(At|^since|^from|^to|^start)$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY_MS = 86_400_000;
const localDay = (ms: number) => Date.parse(`${localTime(ms).slice(0, 10)}T00:00:00Z`) / DAY_MS;
function relativeDay(ms: number, now: number): string {
  const days = localDay(now) - localDay(ms);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  return days > 0 ? `${days} days ago` : `in ${-days} days`;
}
export const stamp = (ms: number, now: number) => `${localTime(ms)} (${relativeDay(ms, now)})`;
export function localTimes(key: string, value: unknown, now: number): unknown {
  if (!TIME_KEY.test(key)) return value;
  if (typeof value === "number") {
    if (value > 1e12 && value < 1e14) return stamp(value, now);
    if (key.endsWith("At") && value > 1e9 && value < 1e11) return stamp(value * 1000, now);
  }
  if (typeof value === "string" && ISO_TIME.test(value)) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return stamp(ms, now);
  }
  return value;
}

export const clockLine = (now: number) => `now: ${now} (${localTime(now)} ${STATUS_TIME_ZONE})`;
