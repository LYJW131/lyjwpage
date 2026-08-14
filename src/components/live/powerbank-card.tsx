"use client";

import NumberFlow from "@number-flow/react";

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
import { cn } from "@/lib/utils";

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
  // 自然落到 idle —— 那件事由电量条和文案去说，状态灯只表达「有没有在动」。
  return status.inputPower > 1 || status.outputPower > 1 ? "live" : "idle";
}

function portTone(port: PowerBankPort, connected: boolean): DotTone {
  if (!connected || !port.active) return "off";
  return (port.power ?? 0) > 1 ? "live" : "idle";
}

/** 充满还需多久。超过一小时按时/分拆，免得出现「132 分钟」这种要心算的写法 */
function timeToFull(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function watts(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)} W`;
}

/** 底部那一行小指标。标题在上、值在下，三列等宽，和端口格对齐 */
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
  const limited = connected && Boolean(data?.thermalLimited);
  const discharging = connected && (data?.outputPower ?? 0) > 1;

  /**
   * 副标题按「现在发生的最重要的事」排优先级：过热 > 充电 > 放电 > 待机。
   * 过热排最前是因为它能解释一个否则会让人以为坏了的现象 —— 插着线但不进电。
   */
  const summary = (() => {
    if (isLoading && !data) return "读取中";
    if (error) return "尚未收到遥测推送";
    if (!connected) return "充电宝未连接";
    if (limited) return "过热保护中，暂停充电";
    if (charging) return "充电中";
    if (discharging) return "供电中";
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
        {/*
          行高写死 h-18，和充电头那张卡同一个理由：NumberFlow 是 web component，
          自带 1.5 行高，而占位文本是普通 span —— 不固定的话断开时整行会塌，
          下面的内容跟着上移。对齐用 items-end 而不是 items-baseline，也是同一个
          原因，详见 charger-card.tsx 里的说明。
        */}
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

          {/* 温度靠右。它不是主读数，但过热时是最该被看到的一条，所以跟着变色 */}
          {connected && data && data.temperatures.length > 0 ? (
            <span
              className={cn(
                "ml-auto pb-1.5 font-mono text-xs",
                limited ? "text-live-idle" : "text-muted-foreground",
              )}
              title="机身温度传感器"
            >
              {data.temperatures.map((value) => `${value}°`).join(" / ")}C
            </span>
          ) : null}
        </div>

        <p className="label-mono mt-1 text-muted-foreground">{summary}</p>

        {/*
          电量条。充电宝没有历史曲线，这条就是这张卡唯一的「一眼看懂」的图形 ——
          百分比是它最主要的状态，用长度表达比只给数字更快。
          充电绿、过热琥珀、其余中性：颜色和状态灯用同一套语义，不另造一套。
        */}
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700",
                !connected
                  ? "bg-live-off"
                  : limited
                    ? "bg-live-idle"
                    : charging
                      ? "bg-live"
                      : "bg-muted-foreground",
              )}
              style={{ width: `${Math.min(Math.max(battery ?? 0, 0), 100)}%` }}
            />
          </div>
        </div>

        {/* 三个数字。放电时「充满还需」没有意义，那一格换成输出 */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Metric label="输入" value={connected ? watts(data?.inputPower) : "—"} muted={!charging} />
          <Metric
            label="输出"
            value={connected ? watts(data?.outputPower) : "—"}
            muted={!discharging}
          />
          <Metric
            label="充满还需"
            value={(charging && timeToFull(data?.timeToFullMinutes)) || "—"}
            muted={!charging}
          />
        </div>

        {/* 三个口：C1/C2 双向，A 只出 */}
        <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
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
                  {/*
                    和充电头那张卡对齐：第三行只讲「这个口现在在干什么」，没在
                    工作就是一个破折号。原来空闲时写的是端口能力（仅输出 / 双向）
                    —— 那是一条永远为真的静态事实，占着一个本该反映当下状态的
                    位置，还让同一行在中英之间跳。

                    方向用大写：这一行是等宽小字号，大写更像状态标签而不是散句。
                  */}
                  {full?.direction === "in"
                    ? "INPUT"
                    : full?.direction === "out"
                      ? "OUTPUT"
                      : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
