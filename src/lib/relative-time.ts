import { site } from "@/lib/site";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: site.timezone });
const absoluteWithYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: site.timezone });

export function formatRelativeTime(atMs: number, nowMs: number): string {
  const diff = nowMs - atMs;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return relative.format(-Math.floor(diff / MINUTE), "minute");
  if (diff < DAY) return relative.format(-Math.floor(diff / HOUR), "hour");
  if (diff < 7 * DAY) return relative.format(-Math.floor(diff / DAY), "day");
  if (diff < 30 * DAY) return relative.format(-Math.floor(diff / (7 * DAY)), "week");
  const at = new Date(atMs);
  const sameYear = at.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return `on ${(sameYear ? absolute : absoluteWithYear).format(at)}`;
}
