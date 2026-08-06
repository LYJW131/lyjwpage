"use client";

import NumberFlow from "@number-flow/react";

import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import type { ChargerPayload, ChargerPort, ChargerStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 数据到达由 SSE 通知，这里的轮询只是兜底 —— 防止 SSE 断了又没重连上时
 * 页面一直停在旧数据。所以间隔放得很宽。
 */
const REFRESH_MS = 60_000;

function tone(status: ChargerStatus | undefined): DotTone {
  if (!status?.connected) return "off";
  return status.totalPower > 1 ? "live" : "idle";
}

function portTone(port: ChargerPort, connected: boolean): DotTone {
  if (!connected || !port.active) return "off";
  return (port.power ?? 0) > 1 ? "live" : "idle";
}

export function ChargerCard({ className }: { className?: string }) {
  const { data, error, isLoading } = useStatus<ChargerPayload>(
    "/api/status/charger",
    REFRESH_MS,
    "charger",
  );
  const history = data?.history ?? [];

  const connected = Boolean(data?.connected);
  const power = data?.totalPower ?? 0;
  const dot = tone(data);
  const ratio = data ? Math.min(power / data.maxPower, 1) : 0;

  return (
    <Card
      label="Charger"
      tone={dot}
      action={
        data?.device.serialNumber ? (
          <span title={`固件 ${data.device.firmwareVersion ?? "未知"}`}>Prime 160W</span>
        ) : (
          "Prime 160W"
        )
      }
      className={cn(
        // 功率越高边框越亮，是那种「看一眼就知道在充」的细节
        "transition-[border-color] duration-500",
        dot === "live" && "border-live/30",
        !connected && "opacity-70",
        className,
      )}
    >
      <div className="flex flex-1 flex-col justify-between px-4 pb-4 pt-2">
        <div className="flex items-end gap-2">
          <div className="text-5xl font-medium tracking-tight tabular-nums">
            {connected ? (
              <NumberFlow
                value={power}
                format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
              />
            ) : (
              <span className="text-muted-foreground">--</span>
            )}
          </div>
          <span className="pb-1.5 font-mono text-lg text-muted-foreground">W</span>
        </div>

        <p className="label-mono mt-1 text-muted-foreground">
          {isLoading && !data
            ? "读取中"
            : error
              ? "尚未收到遥测推送"
              : data?.stale
                ? "遥测已断流"
                : connected
                  ? `${Math.round(ratio * 100)}% / ${data?.maxPower}W`
                  : "充电器未连接"}
        </p>

        {/* 功率曲线：服务端累积的历史。两条坐标轴都固定，不随数据缩放，
            否则每来一个点整条曲线都会挪位 —— 细节见 sparkline.tsx */}
        <div className="-mx-1 mt-3 flex max-h-24 min-h-8 flex-1 items-end">
          <Sparkline samples={history} className="h-full min-h-8 w-full" />
        </div>

        {/* 三个 USB-C 口 */}
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
          {(data?.ports ?? [{ id: "C1" }, { id: "C2" }, { id: "C3" }]).map((port) => {
            const raw = "active" in port ? (port as ChargerPort) : null;
            // 整机断开时端口数据是上一帧的残留，不能当成还在充电照常显示
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
                    <span className="text-muted-foreground">闲置</span>
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
                  {/* 区分两种「没有设备名」：口是空的用 —，
                      插着但 VID/PID 不在收录表里才是 Unknown */}
                  {full?.active ? (full.device ?? "Unknown") : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
