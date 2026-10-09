"use client";

import NumberFlow from "@number-flow/react";
import { useEffect } from "react";

import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useLocalCharging } from "@/hooks/use-local-charging";
import { useLiveChargingFeed } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import {
  POWER_BANK_MODEL,
  ankerModelLabel,
} from "@/lib/charging-device";
import { powerBankActive } from "@/lib/home-layout";
import { POWERBANK_PATH } from "@/lib/paths";
import type {
  PowerBankPayload,
  PowerBankPort,
  PowerBankStatus,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const REFRESH_MS = 30_000;

function tone(status: PowerBankStatus | undefined): DotTone {
  if (!status?.connected) return "off";
  return status.inputPower > 1 || status.outputPower > 1 ? "live" : "idle";
}

function portTone(port: PowerBankPort, connected: boolean): DotTone {
  if (!connected || !port.active) return "off";
  return (port.power ?? 0) > 1 ? "live" : "idle";
}

function timeToFull(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function watts(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)} W`;
}

function Metric({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label-mono text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-sm tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function PowerBankCard({
  fallback,
  className,
  onActiveChange,
  compact = false,
}: {
  fallback: StatusResponse<PowerBankPayload>;
  className?: string;
  onActiveChange?: (active: boolean) => void;
  compact?: boolean;
}) {
  useLiveEvents();
  const local = useLocalCharging().powerBank;
  const { data: remote, error, isLoading, isValidating, servedAt } = useStatus<PowerBankPayload>(
    POWERBANK_PATH,
    local ? 0 : REFRESH_MS,
    {
      fallback,
      revalidateOnFocus: !local,
    },
  );
  const data = useLiveChargingFeed(
    local ?? remote,
    local ? { validating: false } : { validating: isValidating, servedAt },
  );

  const connected = Boolean(data?.connected);
  const battery = data?.battery ?? null;
  const charging = connected && Boolean(data?.charging);
  const limited = connected && Boolean(data?.thermalLimited);
  const discharging = connected && (data?.outputPower ?? 0) > 1;
  // 隐藏时仍须挂载，否则无法收到让卡片恢复的轮询和推送。
  const flowing = powerBankActive(data);
  useEffect(() => {
    onActiveChange?.(flowing);
  }, [flowing, onActiveChange]);
  const onDock = connected && Boolean((data?.ports ?? []).find((p) => p.id === "B")?.active);
  const inputSources = connected
    ? (data?.ports ?? []).filter((port) => port.direction === "in").length
    : 0;
  const dualInput = inputSources >= 2;

  const summary = (() => {
    if (isLoading && !data) return "Loading";
    if (error) return "No telemetry yet";
    if (!connected) return "Power bank disconnected";
    if (limited) return "Overheated, charging paused";
    const inflow = dualInput ? "Dual-port fast charge" : onDock ? "Dock fast charge" : null;
    if (charging && discharging) return inflow ? `${inflow} · Discharging` : "Pass-through";
    if (charging) return inflow ?? "Charging";
    if (discharging) return "Discharging";
    return "Standby";
  })();

  const displayPorts = (() => {
    const portC1 = data?.ports.find((p) => p.id === "C1") ?? { id: "C1" };
    const portC2 = data?.ports.find((p) => p.id === "C2") ?? { id: "C2" };
    const portA = data?.ports.find((p) => p.id === "A") ?? { id: "A" };
    const portB = data?.ports.find((p) => p.id === "B") ?? { id: "B" };

    const hasActivity = (port: PowerBankPort | { id: string }) =>
      "active" in port && Boolean(port.active || port.attached);

    const thirdPort =
      "active" in portB && portB.active
        ? portB
        : hasActivity(portA)
          ? portA
          : hasActivity(portB)
            ? portB
            : portA;

    return [portC1, portC2, thirdPort];
  })();

  return (
    <Card
      label="Power Bank"
      tone={tone(data)}
      action={
        data?.device.firmwareVersion ? (
          <span title={`Firmware ${data.device.firmwareVersion}`}>
            {ankerModelLabel(data.device.model, POWER_BANK_MODEL)}
          </span>
        ) : (
          ankerModelLabel(data?.device.model, POWER_BANK_MODEL)
        )
      }
      className={cn("h-full", className)}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2",
        )}
      >
        <div className="flex h-18 items-end gap-1.5">
          <div className="text-5xl font-medium tracking-tight tabular-nums">
            {connected && battery != null ? (
              <NumberFlow
                value={battery}
                format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              />
            ) : (
              <span className="text-muted-foreground">--.--</span>
            )}
          </div>
          <span className="pb-1 font-mono text-lg text-muted-foreground">%</span>
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
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="h-3.5 shrink-0 overflow-hidden border border-line bg-muted/40">
                <div
                  className={cn(
                    "h-full transition-[width] duration-700",
                    !connected
                      ? "bg-live-off"
                      : limited
                        ? "bg-live-idle"
                        : charging || discharging
                          ? "bg-live"
                          : "bg-muted-foreground",
                  )}
                  style={{ width: `${Math.min(Math.max(battery ?? 0, 0), 100)}%` }}
                />
              </div>

              <div className="mt-3 grid flex-1 grid-cols-3 content-center gap-x-3 gap-y-2">
                <Metric
                  label={dualInput ? "Total Input" : onDock ? "Dock Input" : "Input"}
                  value={connected ? watts(data?.inputPower) : "—"}
                  muted={!charging}
                />
                <Metric
                  label="Output"
                  value={connected ? watts(data?.outputPower) : "—"}
                  muted={!discharging}
                />
                <Metric
                  label="Time to Full"
                  value={(charging && timeToFull(data?.timeToFullMinutes)) || "—"}
                  muted={!charging}
                />
                <Metric
                  label="Temp"
                  value={
                    connected && data && data.temperatures.length > 0
                      ? `${data.temperatures.join(" / ")}°C`
                      : "—"
                  }
                  muted={!connected}
                />
                <Metric
                  label="Health"
                  value={connected && data?.batteryHealth != null ? `${data.batteryHealth}%` : "—"}
                  muted={!connected}
                />
                <Metric
                  label="Capacity"
                  value="72.36 Wh"
                  muted={!connected}
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
              {displayPorts.map((port) => {
                const raw = "active" in port ? (port as PowerBankPort) : null;
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
                        <span className="text-muted-foreground">
                          {full?.attached ? "Plugged" : "Idle"}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted-foreground">
                      {full?.active && full.voltage != null && full.current != null ? (
                        `${full.voltage.toFixed(1)}V · ${full.current.toFixed(2)}A`
                      ) : full?.direction === "in" ? (
                        "INPUT"
                      ) : full?.direction === "out" ? (
                        "OUTPUT"
                      ) : (
                        "—"
                      )}
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
                <span className="label-mono shrink-0 text-muted-foreground">0%</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden border border-line bg-muted/40">
                  <div
                    className={cn(
                      "h-full transition-[width] duration-700",
                      !connected
                        ? "bg-live-off"
                        : limited
                          ? "bg-live-idle"
                          : charging || discharging
                            ? "bg-live"
                            : "bg-muted-foreground",
                    )}
                    style={{ width: `${Math.min(Math.max(battery ?? 0, 0), 100)}%` }}
                  />
                </div>
                <span className="label-mono shrink-0 text-muted-foreground">100%</span>
              </div>
              <div className="mt-2 flex items-center gap-2 truncate font-mono text-[0.6875rem] leading-none text-muted-foreground">
                {displayPorts.map((port, i) => {
                  const full =
                    connected && "active" in port ? (port as PowerBankPort) : null;
                  return (
                    <span key={port.id} className="flex items-center gap-1">
                      {i > 0 && <span className="mr-1 opacity-40">·</span>}
                      <span>{port.id}</span>
                      {full?.direction === "in" ? (
                        <span className="text-foreground" title="Input">
                          ↓
                        </span>
                      ) : full?.direction === "out" ? (
                        <span className="text-foreground" title="Output">
                          ↑
                        </span>
                      ) : (
                        <span className="opacity-70">{full?.attached ? "Plugged" : "Idle"}</span>
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
