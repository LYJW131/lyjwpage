"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";

import { Card } from "@/components/ui/card";
import { useStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { SERVER_STALE_MS } from "@/lib/freshness";
import { SERVER_PATH } from "@/lib/paths";
import type { ServerPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 上报器 30 秒一轮。卡片跟这个节奏走：推送这条路上没有，问得比上报还勤
 * 只是把请求翻倍换同一份数据。
 *
 * 从 15 秒放宽到 30 秒 —— 那是全站最快的一路（第二快的充电头 / 充电宝 30 秒，
 * 其余 60 秒起），而状态端点是 no-store、每次都进函数，一个开着的标签页就是
 * 4 次/分钟。三处一起改：这里、freshness 的 SERVER_STALE_MS、上报器的
 * INTERVAL_MS，顺序见 freshness 里心跳窗口那段（先放宽窗口，再给上报器降频）。
 */
const REFRESH_MS = 30_000;

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

function formatUptime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

function formatPair(used: number, total: number): string {
  const useGb = total >= 1024 ** 3;
  const div = useGb ? 1024 ** 3 : 1024 ** 2;
  const unit = useGb ? "GB" : "MB";
  const digits = useGb ? 1 : 0;
  return `${(used / div).toFixed(digits)} / ${(total / div).toFixed(digits)} ${unit}`;
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

export function ServerCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<ServerPayload>;
  className?: string;
}) {
  const { data, error } = useStatus<ServerPayload>(SERVER_PATH, REFRESH_MS, {
    fallback,
  });
  const staleByClock = useStale(data?.pushedAt, data?.staleAfterMs ?? SERVER_STALE_MS);
  const stale = Boolean(data?.staleAtSource) || staleByClock;
  const memoryPercent = data ? (data.memoryUsedBytes / data.memoryTotalBytes) * 100 : 0;
  const location = data ? formatLocation(data) : null;
  const isp = data ? formatIsp(data) : null;

  const action = (() => {
    if (error && !data) return "No data";
    if (stale) return "Offline";
    return data?.id ? nodeId(data.id) : "—";
  })();

  return (
    <Card
      label="Proxy"
      action={<span title={data ? `${data.id} · ${data.hostname}` : undefined}>{action}</span>}
      className={cn("h-full", className)}
    >
      {/*
        三层：落地身份（小）→ 上下行（主数字）→ CPU / 内存（底栏）。
        内容区 min-h-44，卡头不算。同排的活动卡更高，这张会被拉长：多出来的高度
        用 justify-between 摊进三层之间，别用 justify-center 摊到上下边 —— 那样
        边距会比左右的 p-5 大出一截，四边看着就不是一个数。
      */}
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
