"use client";

import NumberFlow from "@number-flow/react";
import { useEffect } from "react";

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
  onActiveChange,
  compact = false,
}: {
  fallback: StatusResponse<PowerBankPayload>;
  className?: string;
  onActiveChange?: (active: boolean) => void;
  /**
   * 和充电头挤同一格时的精炼形态：只留电量和状态那一行。
   *
   * 半格里塞得下四行：电量（缩一号）、状态、电量条、一行逐口瓦数。砍掉的是指标
   * 网格和端口格那三行式的大方块 —— 温度、健康度、额定能量都不是「扫一眼」要看
   * 的，等它独占整格时再出现。
   */
  compact?: boolean;
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
   * 「真的在动」——和状态灯的 live 判定同一个条件。充电宝大部分时间是插着但
   * 不收不放的，那种状态不该占住共享的那个格子。
   *
   * 和充电头一样，这只用来协调外层布局，不在这里卸载组件：隐藏之后还得继续
   * 收轮询和推送，否则它永远不知道自己该回来了。
   */
  const flowing = charging || discharging;
  useEffect(() => {
    onActiveChange?.(flowing);
  }, [flowing, onActiveChange]);
  /**
   * 两个口同时供电。固件不报这个状态 —— 它只给每个口自己的方向，和两个互相
   * 独立的总量（总输入、总输出），所以「双枪超充」「边充边放」都得这边数出来。
   *
   * 进电侧不做同样的判断：这台机器规格上就是单口 100W 输入，十一份抓包里也从
   * 没出现过两个口同时进电。凭空写一个没见过的状态，只会在真出现时误导人。
   */
  /** 底座进电（端口 B 活跃） */
  const onDock = connected && Boolean((data?.ports ?? []).find((p) => p.id === "B")?.active);
  /** 同时在进电的来路数（C1/C2/B） */
  const inputSources = connected
    ? (data?.ports ?? []).filter((port) => port.direction === "in").length
    : 0;
  const dualInput = inputSources >= 2;

  /**
   * 副标题按「现在发生的最重要的事」排优先级：过热 > 充电 > 放电 > 待机。
   * 过热排最前是因为它能解释一个否则会让人以为坏了的现象 —— 插着线但不进电。
   */
  const summary = (() => {
    if (isLoading && !data) return "读取中";
    if (error) return "尚未收到遥测推送";
    if (!connected) return "充电宝未连接";
    if (limited) return "过热保护中，暂停充电";
    /**
     * 只有进电侧分状态：单口、双枪、底座是三件不同的事，充电速度和插法都不一样。
     * 出电侧不分 —— 一个口出还是两个口出，对着看的人来说都是「在往外供电」，
     * 端口格里已经逐口写着瓦数，标题再拆一遍只是多一个要记的词。
     *
     * 「边充边放」是双向状态本身的名字，只在进电侧没有更具体说法时才用：来路是
     * 双枪或底座的话，那个信息更值钱，别被这个词盖掉。
     */
    const inflow = dualInput ? "双枪超充" : onDock ? "底座快充" : null;
    if (charging && discharging) return inflow ? `${inflow} · 输出中` : "边充边放";
    if (charging) return inflow ?? "充电中";
    if (discharging) return "输出中";
    return "待机";
  })();

  /**
   * 端口槽固定显示三格：C1 与 C2 恒定，第三格在 A 与 B 之间切换。
   * 优先级：哪个有活动显示哪个；两个都有活动时优先显示 B；都空闲时默认显示 A。
   */
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
        data?.device.serialNumber ? (
          <span title={`固件 ${data.device.firmwareVersion ?? "未知"}`}>Prime 20K</span>
        ) : (
          "Prime 20K"
        )
      }
      className={cn("h-full", className)}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2",
          compact ? "justify-center" : "justify-between",
        )}
      >
        {/*
          行高写死 h-18，和充电头那张卡同一个理由：NumberFlow 是 web component，
          自带 1.5 行高，而占位文本是普通 span —— 不固定的话断开时整行会塌，
          下面的内容跟着上移。对齐用 items-end 而不是 items-baseline，也是同一个
          原因，详见 charger-card.tsx 里的说明。
        */}
        <div className={cn("flex items-end gap-1.5", compact ? "h-14" : "h-18")}>
          <div
            className={cn(
              "font-medium tracking-tight tabular-nums",
              compact ? "text-4xl" : "text-5xl",
            )}
          >
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

        {compact && (
          <>
            {/* 和充电头精炼态同一套结构、同样的 mt-*，两张卡叠着时逐行对齐。
                两端的 0%–100% 是量程标注，读法和充电头那条 0W–160W 一致 */}
            <div className="mt-2 flex items-center gap-2">
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
                    {/* 方向是这张卡最要紧的一位：同一个口既能进也能出，只看瓦数
                        分不出它是在给充电宝充电还是在被充电宝供电。
                        ↓ 进电、↑ 出电 —— 箭头指的是电往哪边流，不是端口的角色。 */}
                    {full?.direction === "in" ? (
                      <span className="text-foreground" title="输入">
                        ↓
                      </span>
                    ) : full?.direction === "out" ? (
                      <span className="text-foreground" title="输出">
                        ↑
                      </span>
                    ) : (
                      <span className="opacity-70">{full?.attached ? "已插线" : "闲置"}</span>
                    )}
                    {full?.active && full.power != null && (
                      <span className="text-foreground">{full.power.toFixed(1)}W</span>
                    )}
                  </span>
                );
              })}
            </div>
          </>
        )}

        {!compact && (
        <>
        {/*
          电量条 + 指标网格合起来占一格，高度写死 h-32 —— 和充电头那条功率曲线
          完全一样。两张卡轮流出现在同一个位置，只要行高差几像素，换卡时每一行都
          会挪一下，右边那张最近播放（它是 inset-block:0 贴着这一行的）也跟着跳。
          充电头当初把曲线从 flex-1 改成 h-32，就是为了同一件事，见 charger-card.tsx。

          电量条本身：充电宝没有历史曲线，这条就是这张卡唯一「一眼看懂」的图形。
          充放电绿、过热琥珀、其余中性 —— 颜色和状态灯用同一套语义，不另造一套。
        */}
        <div className="mt-3 flex h-32 shrink-0 flex-col">
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

          {/* 指标网格：2×3。content-center 让两行在剩下的高度里居中，不靠边 */}
          <div className="mt-3 grid flex-1 grid-cols-3 content-center gap-x-3 gap-y-2">
            <Metric
              label={dualInput ? "总输入" : onDock ? "底座输入" : "输入"}
              value={connected ? watts(data?.inputPower) : "—"}
              muted={!charging}
            />
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
            <Metric
              label="机身温度"
              value={
                connected && data && data.temperatures.length > 0
                  ? `${data.temperatures.join(" / ")}°C`
                  : "—"
              }
              muted={!connected}
            />
            {/*
              电池健康度，不是规格常量 —— 上报器每次连上时从设备读一次。这一格
              换掉了原来写死的「额定能量 72.36 Wh」：同一个位置，真数据比铭牌值有用。
            */}
            <Metric
              label="电池健康"
              value={connected && data?.batteryHealth != null ? `${data.batteryHealth}%` : "—"}
              muted={!connected}
            />
            {/*
              规格里只留额定能量：220W 是端口那一行随时能看到的量级，而 72.36 Wh 是
              电量百分比的分母 —— 没有它，「36%」换不成任何一个能用的数。
            */}
            <Metric
              label="额定能量"
              value="72.36 Wh"
              muted={!connected}
            />
          </div>
        </div>

        {/* 完整态的端口格：三行式，逐口带电压电流 */}
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
          {displayPorts.map((port) => {
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
        </>
        )}
      </div>
    </Card>
  );
}
