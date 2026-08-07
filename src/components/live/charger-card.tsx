"use client";

import NumberFlow from "@number-flow/react";
import { useCallback, useRef } from "react";

import { Sparkline } from "@/components/live/sparkline";
import { Card } from "@/components/ui/card";
import { StatusDot, type DotTone } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import type {
  ChargerPayload,
  ChargerPort,
  ChargerSample,
  ChargerStatus,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const CHARGER_PATH = "/api/status/charger";
/** 与 charger-store 的 HISTORY_LIMIT 保持一致，别让拼出来的序列无限长 */
const HISTORY_LIMIT = 400;

/**
 * 服务端产生新采样点的节奏跟着上报器的 postInterval 走，实测中位间隔约 32 秒。
 * 原来固定 5 秒轮询，每产生一个点要空转六七次，拿回来全是一模一样的数据。
 * 取的是服务端存好的快照，调慢不会传导到充电头。
 */
const REFRESH_MS = 15_000;

function tone(status: ChargerStatus | undefined): DotTone {
  if (!status?.connected) return "off";
  return status.totalPower > 1 ? "live" : "idle";
}

function portTone(port: ChargerPort, connected: boolean): DotTone {
  if (!connected || !port.active) return "off";
  return (port.power ?? 0) > 1 ? "live" : "idle";
}

export function ChargerCard({ className }: { className?: string }) {
  /**
   * 曲线自己攒着，每轮只问服务端要新增的点。
   * 放 ref 不放 state：它不参与渲染判断，返回的 payload 里已经带着拼好的
   * 完整序列了，再多一份 state 只会多一次渲染。
   */
  const historyRef = useRef<ChargerSample[]>([]);

  const fetchCharger = useCallback(async (): Promise<StatusResponse<ChargerPayload>> => {
    const known = historyRef.current;
    const since = known.length ? known[known.length - 1].t : null;
    const url = since == null ? CHARGER_PATH : `${CHARGER_PATH}?since=${since}`;

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`请求 ${url} 失败：${response.status}`);
    const envelope = (await response.json()) as StatusResponse<ChargerPayload>;
    if (!envelope.ok) return envelope;

    // historyPartial 为假就是整份快照（首次，或落后太多、服务端已裁掉中间那段）
    const merged = envelope.data.historyPartial
      ? [...known, ...envelope.data.history]
      : envelope.data.history;
    historyRef.current = merged.slice(-HISTORY_LIMIT);

    return { ...envelope, data: { ...envelope.data, history: historyRef.current } };
  }, []);

  const { data, error, isLoading } = useStatus<ChargerPayload>(
    CHARGER_PATH,
    REFRESH_MS,
    fetchCharger,
  );
  const history = data?.history ?? [];

  const connected = Boolean(data?.connected);
  const power = data?.totalPower ?? 0;
  // mode 可能在设备刚停止取电后仍保持开启；实际功率超过空载阈值才算正在充电。
  // 这也和状态灯的 live 判定保持一致，避免一处说“正在充”、一处显示 idle。
  const charging = connected && power > 1;
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
                format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
              />
            ) : (
              <span className="text-muted-foreground">--.-</span>
            )}
          </div>
          <span className="pb-1 font-mono text-lg text-muted-foreground">W</span>
        </div>

        <p className="label-mono mt-1 text-muted-foreground">
          {isLoading && !data
            ? "读取中"
            : error
              ? "尚未收到遥测推送"
              : data?.stale
                ? "遥测已断流"
                : connected
                  ? charging
                    ? `${Math.round(ratio * 100)}% / ${data?.maxPower}W`
                    : "待机"
                  : "充电器未连接"}
        </p>

        {/* 功率曲线：服务端累积的历史。两条坐标轴都固定，不随数据缩放，
            否则每来一个点整条曲线都会挪位 —— 细节见 sparkline.tsx */}
        <div className="mt-3 flex max-h-32 min-h-8 flex-1 items-end">
          <Sparkline
            samples={history}
            formatValue={(watts) => `${watts.toFixed(1)}W`}
            className="h-full min-h-8 w-full"
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
