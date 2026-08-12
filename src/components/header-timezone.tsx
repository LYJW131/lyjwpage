"use client";

import { useStatus } from "@/hooks/use-status";
import { TIMEZONE_PATH } from "@/lib/paths";
import { formatTimezoneRegion, resolveTimezoneDisplay } from "@/lib/timezone-display";
import type { StatusResponse, TimezonePayload } from "@/lib/types";

/** 与 TimezoneCard 同频：存活窗口 45s，一分钟一问足够翻 stale。 */
const REFRESH_MS = 60_000;

export function HeaderTimezone({
  fallback,
}: {
  fallback: StatusResponse<TimezonePayload>;
}) {
  const { data, error } = useStatus<TimezonePayload>(TIMEZONE_PATH, REFRESH_MS, { fallback });
  const { identifier } = resolveTimezoneDisplay(data, error, 0);

  return (
    <span
      className="label-mono hidden shrink-0 text-muted-foreground sm:inline"
      title={identifier}
    >
      {formatTimezoneRegion(identifier)}
    </span>
  );
}
