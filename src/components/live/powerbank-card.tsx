"use client";

import NumberFlow from "@number-flow/react";

import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { POWERBANK_PATH } from "@/lib/paths";
import type {
  PowerBankPayload,
  PowerBankPort,
  PowerBankStatus,
  StatusResponse,
} from "@/lib/types";

/**
 * 滚动读数的低频兜底，和充电头一致。
 *
 * 插拔、充放电切换、热控翻转、整数电量跳格都走实时推送，不靠这条；它只负责让
 * 电量小数位和功率跟上报节奏对齐。
 */
const REFRESH_MS = 30_000;

function tone(status: PowerBankStatus | undefined): DotTone {
  if (!status?.connected) return "off";
  // 有功率在流才算 live：充电宝大部分时间是插着但不动的。过热时功率本来就是 0，
  // 自然落到 idle —— 那件事由副标题和温度的配色去说，状态灯只表达「有没有在动」。
  return status.inputPower > 1 || status.outputPower > 1 ? "live" : "idle";
}

function portTone(port: PowerBankPort, connected: boolean): DotTone {
  if (!connected || !port.active) return "off";
  return (port.power ?? 0) > 1 ? "live" : "idle";
}

/** 充满还需多久。超过一小时按 h/m 拆，免得出现「103 分钟」这种要心算的写法 */
function timeToFull(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export function PowerBankCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<PowerBankPayload>;
  className?: string;
}) {
  useLiveEvents();
  const { data, error, isLoading } = useStatus<PowerBankPayload>(POWERBANK_PATH, REFRESH_MS, {
    fallback,
  });

  const connected = Boolean(data?.connected);
  const battery = data?.battery ?? null;
  const charging = connected && Boolean(data?.charging);
  const history = data?.history ?? [];

  /**
   * 副标题按「现在发生的最重要的事」排优先级：过热 > 充电 > 放电 > 待机。
   * 过热排最前是因为它能解释一个否则会让人以为坏了的现象 —— 插着线但不进电。
   */
  const summary = (() => {
    if (isLoading && !data) return "读取中";
    if (error) return "尚未收到遥测推送";
    if (!connected) return "充电宝未连接";
    if (data?.thermalLimited) return "过热保护中，暂停充电";
    if (charging) {
      const eta = timeToFull(data?.timeToFullMinutes ?? null);
      const input = `输入 ${data?.inputPower.toFixed(1)}W`;
      return eta ? `${input} · 还需 ${eta}` : input;
    }
    if ((data?.outputPower ?? 0) > 1) return `输出 ${data?.outputPower.toFixed(1)}W`;
    return "待机";
  })();

  return (
    <Card
      label="Power Bank"
      tone={tone(data)}
      action={
        data?.device.serialNumber ? (
          <span title={`固件 ${data.device.firmwareVersion ?? "未知"}`}>Prime 20K</span>
        ) : (
          "Prime 20K"
        )
      }
      className={className}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-between px-4 pb-4 pt-2">
        {/* 行高和对齐的处理同充电头卡片，原因见那边的注释 */}
        <div className="flex h-18 items-end gap-1.5">
          <div className="text-5xl font-medium tracking-tight tabular-nums">
            {connected && battery != null ? (
              <NumberFlow
                value={battery}
                format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
              />
            ) : (
              <span className="text-muted-foreground">--.-</span>
            )}
          </div>
          <span className="pb-1 font-mono text-lg text-muted-foreground">%</span>

          {/* 温度靠右：它不属于主读数，但过热时是最该看到的一条 */}
          {connected && data && data.temperatures.length > 0 ? (
            <span
              className={`ml-auto pb-1.5 font-mono text-xs ${
                data.thermalLimited ? "text-amber-500" : "text-muted-foreground"
              }`}
              title="机身温度传感器"
            >
              {data.temperatures.map((value) => `${value}°`).join(" / ")}C
            </span>
          ) : null}
        </div>

        <p className="label-mono mt-1 text-muted-foreground">{summary}</p>

        {/* 电量曲线。高度和充电头那条一致，两张卡并排时基线才齐 */}
        <div className="mt-3 h-32 shrink-0">
          <Sparkline
            samples={history.map((sample) => ({ t: sample.t, w: sample.p }))}
            formatValue={(percent) => `${percent.toFixed(1)}%`}
            className="h-full w-full"
          />
        </div>

        {/* 三个口：C1/C2 双向，A 只出 */}
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
          {(data?.ports ?? [{ id: "C1" }, { id: "C2" }, { id: "A" }]).map((port) => {
            const raw = "active" in port ? (port as PowerBankPort) : null;
            // 整机断开时端口数据是上一帧的残留，不能当成还在工作照常显示
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
                      {/* 插着线但没协商上供电，和什么都没插是两回事 */}
                      {full?.attached ? "已插线" : "闲置"}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted-foreground">
                  {full?.direction === "in"
                    ? "取电中"
                    : full?.direction === "out"
                      ? "供电中"
                      : port.id === "A"
                        ? "仅输出"
                        : "双向"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
