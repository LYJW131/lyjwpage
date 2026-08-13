import { formatTimezoneRegion, resolveTimezoneDisplay } from "@/lib/timezone-display";
import type { StatusResponse, TimezonePayload } from "@/lib/types";

export function HeaderTimezone({
  fallback,
}: {
  fallback: StatusResponse<TimezonePayload>;
}) {
  const { identifier } = resolveTimezoneDisplay(
    fallback.ok ? fallback.data.timezone : null,
    0,
  );

  return (
    <span
      className="label-mono hidden shrink-0 text-muted-foreground sm:inline"
      title={identifier}
    >
      {formatTimezoneRegion(identifier)}
    </span>
  );
}
