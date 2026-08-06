"use client";

import NumberFlow from "@number-flow/react";

import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import type { ChargerPayload, ChargerPort, ChargerStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 数据由那台机器每 30 秒推送到服务端，这里只是去取已经存好的快照，
 * 不会传导到充电头。取快一点只是为了推送到达后尽早显示。
 */
const REFRESH_MS = 5_000;

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
  );
  const history = data?.history ?? [];

  const connected = Boolean(data?.connected);
  const power = data?.totalPower ?? 0;
  // mode 可能在设备刚停止取电后仍保持开启；实际功率超过空载阈值才算正在充电。
  // 这也和状态灯的 live 判定保持一致，避免一处说“正在充”、一处显示 idle。
  const charging = connected && power > 1;
  const dot = tone(data);
  const ratio = data ? Math.min(power / data.maxPower, 1) : 0;
  // 峰值上留 15% 余量，并给一个下限，免得空载时噪声被放大成剧烈波动
  const scale = Math.max(20, ...history.map((s) => s.w)) * 1.15;

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
              : data?.stale
                ? "遥测已断流"
                : connected
                  ? charging
                    ? `${Math.round(ratio * 100)}% / ${data?.maxPower}W`
                    : "待机"
                  : "充电器未连接"}
        </p>

        {/* 功率曲线：服务端累积的历史（推送模式下约 90 分钟）。
            纵轴跟着实际峰值走而不是 160W 满量程 —— 否则日常十几瓦会被压成一条直线。 */}
        <div className="-mx-1 mt-3 flex max-h-24 min-h-8 flex-1 items-end">
          <Sparkline samples={history} max={scale} className="h-full min-h-8 w-full" />
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
