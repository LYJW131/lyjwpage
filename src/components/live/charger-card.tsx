"use client";

import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";

import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import type { ChargerPort, ChargerStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 上游 BLE 本身就是 ~1Hz 推流，再快也拿不到新数据 */
const REFRESH_MS = 1000;
/** 约两分钟的功率曲线 */
const HISTORY_LENGTH = 120;

function tone(status: ChargerStatus | undefined): DotTone {
  if (!status?.connected) return "off";
  return status.totalPower > 1 ? "live" : "idle";
}

function portTone(port: ChargerPort, connected: boolean): DotTone {
  if (!connected || !port.active) return "off";
  return (port.power ?? 0) > 1 ? "live" : "idle";
}

/** 在客户端累积采样 —— 上游只给瞬时快照，历史曲线得自己攒 */
function usePowerHistory(power: number | undefined, updatedAt: number | null | undefined) {
  const [history, setHistory] = useState<number[]>([]);
  const lastStamp = useRef<number | null>(null);

  useEffect(() => {
    if (power === undefined) return;
    // 上游 12 秒才换一次 updated_at 的场景下会重复推同一帧，去掉重复采样
    if (updatedAt != null && updatedAt === lastStamp.current) return;
    lastStamp.current = updatedAt ?? null;

    setHistory((prev) => [...prev, power].slice(-HISTORY_LENGTH));
  }, [power, updatedAt]);

  return history;
}

export function ChargerCard({ className }: { className?: string }) {
  const { data, error, isLoading } = useStatus<ChargerStatus>(
    "/api/status/charger",
    REFRESH_MS,
  );
  const history = usePowerHistory(data?.totalPower, data?.updatedAt);

  const connected = Boolean(data?.connected);
  const power = data?.totalPower ?? 0;
  const dot = tone(data);
  const ratio = data ? Math.min(power / data.maxPower, 1) : 0;
  // 峰值上留 15% 余量，并给一个下限，免得空载时噪声被放大成剧烈波动
  const scale = Math.max(20, ...history) * 1.15;

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
              ? "遥测服务未运行"
              : connected
                ? `${Math.round(ratio * 100)}% / ${data?.maxPower}W`
                : "充电器未连接"}
        </p>

        {/* 功率曲线：客户端累积的最近两分钟采样。
            纵轴跟着实际峰值走而不是 160W 满量程 —— 否则日常十几瓦会被压成一条直线。 */}
        <div className="-mx-1 mt-3 flex max-h-24 min-h-8 flex-1 items-end">
          <Sparkline values={history} max={scale} className="h-full min-h-8 w-full" />
        </div>

        {/* 三个 USB-C 口 */}
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
          {(data?.ports ?? [{ id: "C1" }, { id: "C2" }, { id: "C3" }]).map((port) => {
            const full = "active" in port ? (port as ChargerPort) : null;
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
