import { site } from "@shared/site";
import type { TimezoneActivity } from "@shared/types";

export function validTimezone(identifier: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: identifier }).format();
    return true;
  } catch {
    return false;
  }
}

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

// ICU 只在「本地」英语区给字母缩写（PDT 要 en-US，BST 要 en-GB，SGT 要 en-SG），别处一律回落成 GMT+8，所以逐个区域试。
const ABBREVIATION_LOCALES = ["en-US", "en-GB", "en-AU", "en-SG", "en-IN", "en-NZ", "en-CA", "en-ZA"];
const OFFSET_NAME = /^(GMT|UTC)[+\-−]/;

// ICU 在任何英语区域都只给这些时区 GMT±N；这些地区都不实行夏令时，缩写固定。
const FIXED_ABBREVIATIONS: Record<string, string> = {
  "Asia/Shanghai": "CST",
  "Asia/Taipei": "CST",
  "Asia/Macau": "CST",
  "Asia/Hong_Kong": "HKT",
  "Asia/Tokyo": "JST",
  "Asia/Seoul": "KST",
  "Asia/Bangkok": "ICT",
  "Asia/Ho_Chi_Minh": "ICT",
  "Asia/Phnom_Penh": "ICT",
  "Asia/Vientiane": "ICT",
  "Asia/Jakarta": "WIB",
  "Asia/Pontianak": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
  "Asia/Manila": "PHT",
};

export function timezoneAbbreviation(now: number, timezone: string) {
  const fixed = FIXED_ABBREVIATIONS[timezone];
  if (fixed) return fixed;
  for (const locale of ABBREVIATION_LOCALES) {
    const name = new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(new Date(now))
      .find((item) => item.type === "timeZoneName")?.value;
    if (name && !OFFSET_NAME.test(name)) return name;
  }
  return null;
}

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

// now=0 不能当作 1970 年计算时区偏移；历史偏移可能与当前时区不同。
const BUILD_AT = Date.parse(process.env.BUILD_TIME ?? "") || 0;

export function resolveTimezoneDisplay(reported: TimezoneActivity | null | undefined, now: number) {
  const usingMac = Boolean(reported && validTimezone(reported.identifier));
  const backendTimezone = validTimezone(site.timezone) ? site.timezone : "UTC";
  const identifier = usingMac ? reported!.identifier : backendTimezone;
  const at = now || reported?.observedAt || BUILD_AT;

  return {
    identifier,
    abbreviation: (at ? timezoneAbbreviation(at, identifier) : null)
      ?? (usingMac && reported!.abbreviation && !OFFSET_NAME.test(reported!.abbreviation) ? reported!.abbreviation : null),
    offsetSeconds: at ? timezoneOffsetSeconds(at, identifier) : null,
    usingMac,
  };
}
