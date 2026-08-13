import { site } from "@/lib/site";
import type { TimezoneActivity } from "@/lib/types";

export function validTimezone(identifier: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: identifier }).format();
    return true;
  } catch {
    return false;
  }
}

/** Header 用：保留 IANA 前缀，城市段把 `_` 换成空格，如 Asia/Shanghai、America/New York。 */
export function formatTimezoneRegion(identifier: string) {
  const slash = identifier.indexOf("/");
  if (slash === -1) return identifier;
  const prefix = identifier.slice(0, slash);
  const city = identifier.slice(slash + 1).replace(/_/g, " ");
  return `${prefix}/${city}`;
}

export function formatUTCOffset(seconds: number) {
  const sign = seconds < 0 ? "−" : "+";
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3_600);
  const minutes = Math.floor((absolute % 3_600) / 60);
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value ?? "00";
}

export function timezoneAbbreviation(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(new Date(now));
  return parts.find((item) => item.type === "timeZoneName")?.value ?? null;
}

/** 算任意 IANA 时区在这一刻的偏移，不能用浏览器的 getTimezoneOffset。 */
export function timezoneOffsetSeconds(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(part(parts, type));
  const representedAsUTC = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return representedAsUTC / 1_000 - Math.floor(now / 1_000);
}

/**
 * 构建期焊死的时刻。`process.env.BUILD_TIME` 必须整段写开，Next 才能替换成字面量。
 * 首帧 now===0 时用它（或上报的 observedAt）算偏移，不能拿 1970（新加坡当年还是 +07:30）。
 */
const BUILD_AT = Date.parse(process.env.BUILD_TIME ?? "") || 0;

/**
 * 有合法的 Mac IANA 就用；没有或无效才回退 site.timezone。
 * 不看上报器在不在线 —— 时区不是会过期的快照，是一个地点。
 * 访客浏览器时区绝不参与，否则同一页在不同访客眼里会显示不同「本机时间」。
 *
 * 缩写和偏移按时刻从标识现算，不沿用上报的 secondsFromGMT，夏令时才能自己翻。
 * 钟面的 now===0 只是哨兵：偏移改用 observedAt / 构建时刻，才能和时区名一起进预渲染。
 */
export function resolveTimezoneDisplay(reported: TimezoneActivity | null | undefined, now: number) {
  const usingMac = Boolean(reported && validTimezone(reported.identifier));
  const backendTimezone = validTimezone(site.timezone) ? site.timezone : "UTC";
  const identifier = usingMac ? reported!.identifier : backendTimezone;
  const at = now || reported?.observedAt || BUILD_AT;

  return {
    identifier,
    abbreviation: at ? timezoneAbbreviation(at, identifier) : null,
    offsetSeconds: at ? timezoneOffsetSeconds(at, identifier) : null,
    usingMac,
  };
}
