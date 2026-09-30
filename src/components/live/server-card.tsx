"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";

import { Card } from "@/components/ui/card";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { SERVER_STALE_MS } from "@/lib/freshness";
import { SERVER_PATH } from "@/lib/paths";
import type { ServerPayload, ServerTraffic, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const RATE_FORMAT_BYTES = { maximumFractionDigits: 0 } as const;
const RATE_FORMAT_SCALED = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

function rateParts(bytesPerSec: number): { value: number; unit: string } {
  if (bytesPerSec >= 1_000_000) return { value: bytesPerSec / 1_000_000, unit: "MB/s" };
  if (bytesPerSec >= 1_000) return { value: bytesPerSec / 1_000, unit: "KB/s" };
  return { value: bytesPerSec, unit: "B/s" };
}

function formatLocation(data: ServerPayload): string | null {
  if (data.city && data.country) return `${data.city}, ${data.country}`;
  return data.city ?? data.country;
}

function formatIsp(data: ServerPayload): string | null {
  return data.asnOrg ?? data.isp;
}

export function formatUptime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

type Tier = { div: number; unit: string; digits: number };

const MEMORY_TIERS: readonly Tier[] = [
  { div: 1024 ** 3, unit: "GB", digits: 1 },
  { div: 1024 ** 2, unit: "MB", digits: 0 },
];

const TRAFFIC_TIERS: readonly Tier[] = [
  { div: 1e12, unit: "TB", digits: 2 },
  { div: 1e9, unit: "GB", digits: 1 },
  { div: 1e6, unit: "MB", digits: 0 },
];

function tierIndex(tiers: readonly Tier[], bytes: number): number {
  const found = tiers.findIndex((tier) => bytes >= tier.div);
  return found < 0 ? tiers.length - 1 : found;
}

function tierAt(tiers: readonly Tier[], index: number): Tier {
  return tiers[Math.min(Math.max(index, 0), tiers.length - 1)];
}

function formatSize(tiers: readonly Tier[], bytes: number, tier?: Tier): string {
  const pick = tier ?? tierAt(tiers, tierIndex(tiers, bytes));
  return `${(bytes / pick.div).toFixed(pick.digits)} ${pick.unit}`;
}

function formatFraction(tiers: readonly Tier[], used: number, total: number): string {
  const tier = tierAt(tiers, tierIndex(tiers, total));
  return `${(used / tier.div).toFixed(tier.digits)} / ${formatSize(tiers, total, tier)}`;
}

function formatPair(used: number, total: number): string {
  return formatFraction(MEMORY_TIERS, used, total);
}

// 显式 UTC，避免服务端与访客时区不同导致 title 水合不一致。
function formatCycleDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

function nodeId(id: string): string {
  const dash = id.indexOf("-");
  if (dash < 0) return id;
  const name = id.slice(0, dash);
  const rest = id.slice(dash + 1);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}-${rest.toUpperCase()}`;
}

function Rate({ label, bytesPerSec }: { label: string; bytesPerSec: number | null }) {
  const parts = bytesPerSec == null ? null : rateParts(bytesPerSec);
  return (
    <div className="min-w-0">
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="flex h-9 items-end gap-1">
        {parts ? (
          <>
            <span className="text-2xl font-medium tracking-tight tabular-nums">
              <NumberFlow
                value={parts.value}
                format={parts.unit === "B/s" ? RATE_FORMAT_BYTES : RATE_FORMAT_SCALED}
              />
            </span>
            <span className="pb-0.5 font-mono text-xs text-muted-foreground">{parts.unit}</span>
          </>
        ) : (
          <span className="text-2xl font-medium tabular-nums text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function Meter({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-mono text-muted-foreground">{label}</span>
        <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
          {detail}
        </span>
      </div>
      <div className="mt-1 h-1 bg-muted">
        <div
          className="h-full bg-live transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

function Traffic({ traffic }: { traffic: ServerTraffic }) {
  const { rxBytes, txBytes, quotaBytes } = traffic;
  const used = rxBytes + txBytes;
  const span = quotaBytes ?? used;
  const scale = span > 0 ? 100 / span : 0;
  const downPercent = Math.min(100, rxBytes * scale);
  const upPercent = Math.min(100 - downPercent, txBytes * scale);
  const detail = quotaBytes
    ? formatFraction(TRAFFIC_TIERS, used, quotaBytes)
    : `↓ ${formatSize(TRAFFIC_TIERS, rxBytes)} · ↑ ${formatSize(TRAFFIC_TIERS, txBytes)}`;

  return (
    <div
      className="min-w-0"
      title={
        `${formatCycleDay(traffic.cycleStart)} → ${formatCycleDay(traffic.cycleEnd)}` +
        ` · ↓ ${formatSize(TRAFFIC_TIERS, rxBytes)} ↑ ${formatSize(TRAFFIC_TIERS, txBytes)}`
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-mono text-muted-foreground">Traffic</span>
        <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
          {detail}
        </span>
      </div>
      <div className="mt-1 flex h-1 bg-muted">
        <div
          className="h-full bg-live transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${downPercent}%` }}
        />
        <div
          className="h-full bg-live/40 transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${upPercent}%` }}
        />
      </div>
    </div>
  );
}

export function ServerCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<ServerPayload>;
  className?: string;
}) {
  const { data, updatedAt, error, servedAt } = useStatus<ServerPayload>(SERVER_PATH, {
    fallback,
  });
  const stale = useStale(updatedAt ?? data?.pushedAt, SERVER_STALE_MS, servedAt);
  const memoryPercent = data ? (data.memoryUsedBytes / data.memoryTotalBytes) * 100 : 0;
  const location = data ? formatLocation(data) : null;
  const isp = data ? formatIsp(data) : null;

  const action = (() => {
    if (error && !data) return "No data";
    if (stale) return "Unavailable";
    return data?.id ? nodeId(data.id) : "—";
  })();

  return (
    <Card
      id="exit-node"
      label="Exit Node"
      action={<span title={data ? `${data.id} · ${data.hostname}` : undefined}>{action}</span>}
      className={cn("h-full scroll-mt-28", className)}
    >
      <div className="flex h-full min-h-44 flex-col justify-between gap-3 p-4 lg:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium" title={location ?? undefined}>
              {location ?? <span className="text-muted-foreground">—</span>}
            </div>
            <div className="truncate text-sm text-muted-foreground" title={isp ?? undefined}>
              {isp ?? "—"}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="label-mono text-muted-foreground">Uptime</div>
            <div className="font-mono text-lg tabular-nums">
              {data ? formatUptime(data.uptimeSeconds) : <span className="text-muted-foreground">—</span>}
            </div>
          </div>
        </div>

        <NumberFlowGroup>
          <div className="grid grid-cols-2 gap-3">
            <Rate
              label="Download"
              bytesPerSec={data ? data.networkRxBytesPerSec : null}
            />
            <Rate
              label="Upload"
              bytesPerSec={data ? data.networkTxBytesPerSec : null}
            />
          </div>
        </NumberFlowGroup>

        {data?.traffic ? <Traffic traffic={data.traffic} /> : null}

        <div className="grid grid-cols-2 gap-3">
          <Meter
            label="CPU"
            percent={data?.cpuUsagePercent ?? 0}
            detail={data ? `${data.cpuUsagePercent.toFixed(1)}%` : "—"}
          />
          <Meter
            label="Memory"
            percent={data ? memoryPercent : 0}
            detail={data ? formatPair(data.memoryUsedBytes, data.memoryTotalBytes) : "—"}
          />
        </div>
      </div>
    </Card>
  );
}
