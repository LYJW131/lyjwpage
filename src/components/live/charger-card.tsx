"use client";

import NumberFlow from "@number-flow/react";
import { useEffect } from "react";

import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { incrementalFetcher, useStatus } from "@/hooks/use-status";
import {
  historyCursor,
  mergeChargerHistory,
  seedChargerHistory,
} from "@/lib/charger-history";
import { CHARGER_PATH } from "@/lib/paths";
import type {
  ChargerPayload,
  ChargerPort,
  ChargerStatus,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 滚动读数的低频兜底。
 *
 * 采集端是 1 Hz，但上报按上报器的节流窗口走（那边可配，代码默认 10 秒、本机
 * 配的是 30 秒）。插拔和上下线已经走实时推送，不靠这条；功率曲线跟上报节奏
 * 对齐，30 秒取一次。
 */
const REFRESH_MS = 30_000;

/**
 * 曲线增量拉取。游标和合并都在 lib/charger-history，推送和轮询共用同一套 ——
 * 所以这个壳子在模块作用域就能造好，天然是稳定引用。
 */
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
  /**
   * 和充电宝挤同一格时的精炼形态：只留主数字和状态那一行。
   *
   * 半格里塞得下四行：主数字（缩一号）、状态、一条占比细条、一行逐口瓦数。
   * 砍掉的是功率曲线和端口格那三行式的大方块 —— 前者要 128px，后者要 62px，
   * 两个都不是「扫一眼」需要的东西。
   */
  compact?: boolean;
}) {
  /**
   * 插拔/换设备时服务端会推一条事件，直接写进这个键；滚动读数照旧靠轮询。
   *
   * 这里刻意不看 connected：和 desktop / music 不同，这张卡的轮询本来就不是
   * 推送的兜底，它自己就是数据来源，断不断连都得按同一个节奏问。
   */
  useLiveEvents();
  const { data, error, isLoading } = useStatus<ChargerPayload>(CHARGER_PATH, REFRESH_MS, {
    fallback,
    fetcher: fetchCharger,
    seedFallback: seedChargerHistory,
  });
  const history = data?.history ?? [];

  const connected = Boolean(data?.connected);
  const power = data?.totalPower ?? 0;
  // mode 可能在设备刚停止取电后仍保持开启；实际功率超过空载阈值才算正在充电。
  // 这也和状态灯的 live 判定保持一致，避免一处说“正在充”、一处显示 idle。
  const charging = connected && power > 1;

  // 卡片自己最先拿到轮询/推送后的供电态；把它交给外层只为协调两张卡的布局动画。
  // 不在这里卸载组件，否则隐藏后就收不到下一次轮询或“重新连接”的实时推送了。
  useEffect(() => {
    onActiveChange?.(charging);
  }, [charging, onActiveChange]);

  const dot = tone(data);
  const ratio = data ? Math.min(power / data.maxPower, 1) : 0;

  /**
   * 两种形态用同一句话。精炼态曾经只写「充电中」，那是因为当时下面还有一行
   * 「额定 160W · 占用 63%」，写全会重复；那行删掉之后就没理由不一致了 ——
   * 顶部这两行在收放时是不动的，文案一变就等于在「不动」的地方动了一下。
   */
  const summary = (() => {
    if (isLoading && !data) return "读取中";
    if (error) return "尚未收到遥测推送";
    if (!connected) return "充电器未连接";
    if (!charging) return "待机";
    return `${Math.round(ratio * 100)}% / ${data?.maxPower}W`;
  })();

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
      className={cn("h-full", className)}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2",
        )}
      >
        {/*
          行高写死：NumberFlow 这个 web component 自带 1.5 行高（72px），
          而占位文本是普通 span（48px）—— 不固定的话断开时整行塌 24px，
          下面的说明文案和曲线跟着上移。
          没有给数字区预留固定宽度：按 160.0 预留的话，日常两位数会在数字和 W
          之间空出一大块。W 跟着数字宽度走是正常排版，竖直方向不跳才是关键。

          单位的对齐：不能用 items-baseline —— NumberFlow 是 web component，
          基线由浏览器合成（取盒底），实测会让 W 高出 15px。也不能给数字加
          leading-none —— 它的滚动动画依赖行高，会把数字撕成上下两截。
          所以 items-end 底边对齐，再按实测补 4px：两边盒底相同，但字形底
          分别在 257 和 261（半行距 0 vs 5、字体下伸 14 vs 5）。
        */}
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

        {/*
          下半区：两种形态叠着放，靠 opacity 交叉淡入淡出，不靠 display 硬切。

          上面那个大数字和状态行在两种形态里一模一样 —— 尺寸、位置都不变，所以整
          格在收放时它们纹丝不动。会换的只有这一区，而这一区正好就是高度在变的那
          一段：盒子平滑插值，里面两层同时对着淡，眼睛看到的是一次溶解，不是一帧
          跳完的替换。

          两层都常驻 DOM，只改透明度：换成条件渲染的话，新那层会在动画第一帧就以
          最终布局出现在一个还没长到位的盒子里 —— 那一下就是「中间的布局跳动」。
        */}
        <div className="relative mt-3 min-h-0 flex-1">
          <div
            className={cn(
              "absolute inset-0 flex flex-col transition-opacity duration-300",
              compact && "pointer-events-none opacity-0",
            )}
            aria-hidden={compact}
          >
            {/* 功率曲线：高度写死 h-32。以前用 flex-1 + min-h-8，没数据时只占
                32px、有历史后又撑到 128px，整张卡（连带旁边听歌那张）跟着跳。
                两条坐标轴都固定，不随数据缩放 —— 细节见 sparkline.tsx */}
            <div className="min-h-0 flex-1">
              <Sparkline
                samples={history}
                formatValue={(watts) => `${watts.toFixed(1)}W`}
                className="h-full w-full"
              />
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
          <div
            className={cn(
              "absolute inset-x-0 top-0 transition-opacity duration-300",
              !compact && "pointer-events-none opacity-0",
            )}
            aria-hidden={!compact}
          >
              {/*
                精炼态的两行补充。和充电宝那张用同一套结构和同样的 mt-*，两张卡上下
                叠着时每一行都得落在同一个高度上，差几像素就看得出来。

                条子两端标着量程 0W–160W。标了端点它才只有一种读法：「上面那个数，
                在这条刻度上占多少」—— 充电宝那张同一位置标 0%–100%，同一种读法。
                没有端点的两条光秃秃的进度条，一个是负载表一个是油量表，长得一模一样
                意思却相反，叠着看只会让人去比两个不能比的东西。
              */}
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
                      {/* 充电头三个口恒定出电，箭头照画不省 —— 和充电宝那张的
                          同一行对齐，两张叠着时读起来才是同一种东西 */}
                      {full?.active ? (
                        <span className="text-foreground" title="输出">
                          ↑
                        </span>
                      ) : (
                        <span className="opacity-70">闲置</span>
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
