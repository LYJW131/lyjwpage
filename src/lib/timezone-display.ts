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
    abbreviation: at ? timezoneAbbreviation(at, identifier) : null,
    offsetSeconds: at ? timezoneOffsetSeconds(at, identifier) : null,
    usingMac,
  };
}
