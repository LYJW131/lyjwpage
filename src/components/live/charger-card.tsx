"use client";

import NumberFlow from "@number-flow/react";
import { useEffect } from "react";

import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useLocalCharging } from "@/hooks/use-local-charging";
import { useLiveChargingFeed } from "@/hooks/use-stale";
import { incrementalFetcher, useStatus } from "@/hooks/use-status";
import {
  historyCursor,
  mergeChargerHistory,
  seedChargerHistory,
} from "@/lib/charger-history";
import {
  CHARGER_MODEL,
  ankerModelLabel,
} from "@/lib/charging-device";
import { chargerActive } from "@/lib/home-layout";
import { CHARGER_PATH } from "@/lib/paths";
import type {
  ChargerPayload,
  ChargerPort,
  ChargerStatus,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;

const fetchCharger = incrementalFetcher<ChargerPayload>(historyCursor, mergeChargerHistory);

function tone(status: ChargerStatus | undefined): DotTone {
  if (!status?.connected) return "off";
  return status.totalPower > 1 ? "live" : "idle";
}

function portTone(port: ChargerPort, connected: boolean): DotTone {
  if (!connected || !port.active) return "off";
  return (port.power ?? 0) > 1 ? "live" : "idle";
}

export function ChargerCard({
  fallback,
  className,
  onActiveChange,
  compact = false,
}: {
  fallback: StatusResponse<ChargerPayload>;
  className?: string;
  onActiveChange?: (active: boolean) => void;
  compact?: boolean;
}) {
  useLiveEvents();
  const local = useLocalCharging().charger;
  const { data: remote, error, isLoading, isValidating, servedAt } = useStatus<ChargerPayload>(
    CHARGER_PATH,
    local ? 0 : REFRESH_MS,
    {
      fallback,
      fetcher: fetchCharger,
      seedFallback: seedChargerHistory,
      revalidateOnFocus: !local,
    },
  );
  const data = useLiveChargingFeed(
    local ?? remote,
    local ? { validating: false } : { validating: isValidating, servedAt },
  );
  const history = data?.history ?? [];

  const connected = Boolean(data?.connected);
  const power = data?.totalPower ?? 0;
  const charging = chargerActive(data);

  // 隐藏时仍须挂载，否则无法收到让卡片恢复的轮询和推送。
  useEffect(() => {
    onActiveChange?.(charging);
  }, [charging, onActiveChange]);

  const dot = tone(data);
  const ratio = data ? Math.min(power / data.maxPower, 1) : 0;

  const summary = (() => {
    if (isLoading && !data) return "Loading";
    if (error) return "No telemetry yet";
    if (!connected) return "Charger disconnected";
    if (!charging) return "Standby";
    return `${Math.round(ratio * 100)}% / ${data?.maxPower}W`;
  })();

  return (
    <Card
      label="Charger"
      tone={dot}
      action={
        data?.device.serialNumber ? (
          <span title={`Firmware ${data.device.firmwareVersion ?? "unknown"}`}>
            {ankerModelLabel(data.device.model, CHARGER_MODEL)}
          </span>
        ) : (
          ankerModelLabel(data?.device.model, CHARGER_MODEL)
        )
      }
      className={cn("h-full", className)}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2",
        )}
      >
        {/* NumberFlow 的合成基线取盒底；用底边对齐，且保留动画依赖的行高。 */}
        <div className="flex h-18 items-end gap-1.5">
          <div className="text-5xl font-medium tracking-tight tabular-nums">
            {connected ? (
              <NumberFlow
                value={power}
                format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              />
            ) : (
              <span className="text-muted-foreground">--.--</span>
            )}
          </div>
          <span className="pb-1 font-mono text-lg text-muted-foreground">W</span>
        </div>

        <p className="label-mono mt-1 text-muted-foreground">{summary}</p>

        <div className="relative mt-3 min-h-0 flex-1">
          <div
            className={cn(
              "absolute inset-0 flex flex-col transition-opacity duration-300",
              compact && "pointer-events-none opacity-0",
            )}
            aria-hidden={compact}
          >
            <div className="min-h-0 flex-1">
              <Sparkline
                samples={history}
                bucket={!local}
                formatValue={(watts) => `${watts.toFixed(1)}W`}
                className="h-full w-full"
              />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
              {(data?.ports ?? [{ id: "C1" }, { id: "C2" }, { id: "C3" }]).map((port) => {
                const raw = "active" in port ? (port as ChargerPort) : null;
                const full = connected ? raw : null;
                return (
                  <div key={port.id} className="bg-surface px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <StatusDot tone={full ? portTone(full, connected) : "off"} />
                      <span className="label-mono text-muted-foreground">{port.id}</span>
                    </div>
                    <div className="mt-1.5 font-mono text-sm">
                      {full?.active && full.power != null ? (
                        `${full.power.toFixed(1)}W`
                      ) : (
                        <span className="text-muted-foreground">Idle</span>
                      )}
                    </div>
                    <div
                      className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted-foreground"
                      title={
                        full?.device
                          ? [full.device, full.protocol, full.cable].filter(Boolean).join(" · ")
                          : undefined
                      }
                    >
                      {full?.active ? (full.device ?? "Unknown") : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className={cn(
              "absolute inset-x-0 top-0 transition-opacity duration-300",
              !compact && "pointer-events-none opacity-0",
            )}
            aria-hidden={!compact}
          >
              <div className="flex items-center gap-2">
                <span className="label-mono shrink-0 text-muted-foreground">0W</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden border border-line bg-muted/40">
                  <div
                    className={cn(
                      "h-full transition-[width] duration-700",
                      charging ? "bg-live" : "bg-muted-foreground",
                    )}
                    style={{ width: `${Math.min(Math.max(ratio * 100, 0), 100)}%` }}
                  />
                </div>
                <span className="label-mono shrink-0 text-muted-foreground">
                  {data?.maxPower ?? 160}W
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 truncate font-mono text-[0.6875rem] leading-none text-muted-foreground">
                {(data?.ports ?? [{ id: "C1" }, { id: "C2" }, { id: "C3" }]).map((port, i) => {
                  const full = connected && "active" in port ? (port as ChargerPort) : null;
                  return (
                    <span key={port.id} className="flex items-center gap-1">
                      {i > 0 && <span className="mr-1 opacity-40">·</span>}
                      <span>{port.id}</span>
                      {full?.active ? (
                        <span className="text-foreground" title="Output">
                          ↑
                        </span>
                      ) : (
                        <span className="opacity-70">Idle</span>
                      )}
                      {full?.active && full.power != null && (
                        <span className="text-foreground">{full.power.toFixed(1)}W</span>
                      )}
                    </span>
                  );
                })}
              </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
