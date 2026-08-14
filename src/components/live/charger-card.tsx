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
}: {
  fallback: StatusResponse<ChargerPayload>;
  className?: string;
  onActiveChange?: (active: boolean) => void;
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
      className={cn("h-full min-h-[374px]", className)}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-between px-4 pb-4 pt-2">
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

        <p className="label-mono mt-1 text-muted-foreground">
          {isLoading && !data
            ? "读取中"
            : error
              ? "尚未收到遥测推送"
              : connected
                ? charging
                  ? `${Math.round(ratio * 100)}% / ${data?.maxPower}W`
                  : "待机"
                : "充电器未连接"}
        </p>

        {/* 功率曲线：高度写死 h-32。以前用 flex-1 + min-h-8，没数据时只占
            32px、有历史后又撑到 128px，整张卡（连带旁边听歌那张）跟着跳。
            两条坐标轴都固定，不随数据缩放 —— 细节见 sparkline.tsx */}
        <div className="mt-3 h-32 shrink-0">
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
    </Card>
  );
}
