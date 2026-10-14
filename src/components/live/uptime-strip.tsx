"use client";

import { CRON_HEARTBEAT_EVERY_MINUTES } from "@shared/health";
import type { HealthSeries, SiteUptime, UptimeDay } from "@shared/health-types";
import { cn } from "@/lib/utils";

const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const number = new Intl.NumberFormat("en-US");

const every = (minutes: number) => (minutes === 1 ? "minute" : `${minutes} minutes`);
const HEARTBEAT_EVERY = every(CRON_HEARTBEAT_EVERY_MINUTES);

function percent(ratio: number | null | undefined): string {
  if (ratio == null) return "—";
  return ratio >= 1 ? "100%" : `${(Math.floor(ratio * 10_000) / 100).toFixed(2)}%`;
}

function dayTone(entry: UptimeDay): { className: string; label: string } {
  const total = entry.success + entry.failure;
  if (total === 0) return { className: "bg-muted", label: "No data" };
  const ratio = entry.success / total;
  if (ratio >= 0.9995) return { className: "bg-live/85", label: percent(ratio) };
  if (ratio >= 0.99) return { className: "bg-live-idle", label: percent(ratio) };
  return { className: "bg-red-500/80", label: percent(ratio) };
}

const STATUS: Record<HealthSeries["status"], { label: string; className: string }> = {
  up: { label: "Operational", className: "text-live" },
  down: { label: "Down", className: "text-red-500" },
  unknown: { label: "Unknown", className: "text-muted-foreground" },
};

const UNAVAILABLE = { label: "Unavailable", className: "text-muted-foreground" };

function HealthRow({ name, health, statusTitle, footTitle, unit, stale }: {
  name: string; health: HealthSeries; statusTitle: string; footTitle: string; unit: string; stale: boolean;
}) {
  const status = stale ? UNAVAILABLE : STATUS[health.status] ?? STATUS.unknown;
  return (
    <div className={cn(stale && "[&>:not(:first-child)]:opacity-40")}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{name}</span>
        <span className={cn("text-xs", status.className)} title={statusTitle}>{status.label}</span>
      </div>
      {health.days.length > 0 && (
        <div className="flex h-6 gap-[3px]" role="img" aria-label={`${name} daily availability, last ${health.days.length} days`}>
          {health.days.map((entry) => {
            const tone = dayTone(entry);
            const failed = entry.failure ? ` · ${number.format(entry.failure)} failed ${unit}${entry.failure === 1 ? "" : "s"}` : "";
            return <span key={entry.dayStart} title={`${day.format(entry.dayStart)} · ${tone.label}${failed}`} className={cn("min-w-0 flex-1", tone.className)} />;
          })}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-2xs tabular-nums text-muted-foreground">
        <span className="shrink-0">{health.days.length || 30} days ago</span>
        <span className="h-px min-w-3 flex-1 bg-line" aria-hidden />
        <span className="shrink-0 whitespace-nowrap" title={`24h ${percent(health.availability24h)} · ${footTitle}`}>
          {percent(health.availability30d)} uptime
        </span>
        <span className="h-px min-w-3 flex-1 bg-line" aria-hidden />
        <span className="shrink-0">Today</span>
      </div>
    </div>
  );
}

export function UptimeStrip({ site, core, siteStale = false, coreStale = false }: {
  site: SiteUptime | null; core: HealthSeries | null; siteStale?: boolean; coreStale?: boolean;
}) {
  if (!site && !core) return null;
  return (
    <div className="flex flex-col gap-5 border-t border-line p-4 lg:p-5">
      {site && (
        <HealthRow name={new URL(site.url).host} health={site} unit="check" stale={siteStale}
          statusTitle={`Per-minute check from the collector Worker · GET ${site.url}`}
          footTitle={`checked every ${site.intervalSeconds}s`} />
      )}
      {core && (
        <HealthRow name="Core" health={core} unit="heartbeat" stale={coreStale}
          statusTitle={`Cron heartbeat of the core Worker every ${HEARTBEAT_EVERY} (Durable Objects and KV)`}
          footTitle={`cron heartbeat every ${HEARTBEAT_EVERY}`} />
      )}
    </div>
  );
}
