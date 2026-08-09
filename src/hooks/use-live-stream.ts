"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";
import type { ScopedMutator } from "swr";

import { mergeChargerHistory } from "@/lib/charger-history";
import type { LiveEvent } from "@/lib/live-events";
import {
  CHARGER_PATH,
  DESKTOP_PATH,
  MUSIC_PATH,
  NOW_WATCHING_PATH,
  STREAM_PATH,
} from "@/lib/paths";
import type { ChargerPayload, StatusResponse } from "@/lib/types";

/**
 * 事件名 → 写哪个 SWR 缓存键，以及写进去之前要不要先过一道合并。
 *
 * 四条以前是四段几乎一样的 addEventListener，只有键和「要不要合并」不同。
 * 表化之后加一种推送就是加一行。
 *
 * 全都 revalidate: false —— 推来的就是最新的，没必要再回源确认一次。
 */
const FORWARDS: ReadonlyArray<{
  event: LiveEvent["type"];
  path: string;
  merge?: (data: unknown) => unknown;
}> = [
  { event: "desktop", path: DESKTOP_PATH },
  { event: "music", path: MUSIC_PATH },
  // Emby 正在播放：webhook 驱动，服务端手上已经是最新的。列表不动 —— 它由后端
  // 轮询 Emby，节奏慢得多，真要变也得等服务端那层缓存过期，跟着走没有意义。
  { event: "watching", path: NOW_WATCHING_PATH },
  /**
   * 充电头只在插拔、换设备时来事件。曲线的合并走和轮询同一个累加器
   * （lib/charger-history）：推来的那份不带历史点（空增量），所以合并只是把
   * 已有曲线原样接上 —— 游标不会被扰动，下一轮轮询照常从正确的位置继续拉。
   */
  {
    event: "charger",
    path: CHARGER_PATH,
    merge: (data) => mergeChargerHistory(data as ChargerPayload),
  },
];

/**
 * 上报器上下线时要重取的键。
 *
 * 只有 Mac 上报器供数的那几张卡在列。Emby 正在看不在其中 —— 那条由 Emby 的
 * webhook 驱动，getNowWatching 从头到尾不碰上报器，Mac 睡了不影响你在 Emby 上
 * 看什么，跟着重取纯属白跑一趟。
 *
 * vibe coding 也不在：token 用量是累计的历史事实，Mac 掉线它不会变得不可信，
 * 只是不再增长，没有理由跟着变灰。
 */
const PRESENCE_PATHS = [DESKTOP_PATH, MUSIC_PATH, CHARGER_PATH];

/**
 * 整页共用一条 SSE 连接。
 *
 * 现在有多个组件要读活动状态（Live Desk 的前台应用、Recently Played 的本机
 * 播放），如果每个都自己 new 一个 EventSource，一个页面就会占掉好几条长连接。
 * 所以连接做成模块级单例，按订阅者数量开关。
 */
let source: EventSource | null = null;
let refCount = 0;

function open(mutate: ScopedMutator) {
  if (source) return;
  const next = new EventSource(STREAM_PATH);
  source = next;

  for (const { event, path, merge } of FORWARDS) {
    next.addEventListener(event, (message: MessageEvent<string>) => {
      const parsed: unknown = JSON.parse(message.data);
      const envelope: StatusResponse<unknown> = {
        ok: true,
        data: merge ? merge(parsed) : parsed,
      };
      void mutate(path, envelope, { revalidate: false });
    });
  }

  // 上报器上下线：不带数据，只让它供数的那几张卡重取一次，同时翻
  next.addEventListener("presence", () => {
    for (const path of PRESENCE_PATHS) void mutate(path);
  });
}

function close() {
  source?.close();
  source = null;
}

/**
 * 订阅服务端推送。
 *
 * 推来的活动状态直接写进 SWR 缓存，所以组件那边照旧用 useStatus 读，
 * 不用管数据是推来的还是轮询来的。
 *
 * 不对外暴露连接状态。从前暴露了一个 connected，让几张卡在断开时把轮询从
 * 30 秒压到 3 秒 —— 但 EventSource 自带重连（没下发 retry，走浏览器默认约
 * 3 秒），断线基本三秒内自愈，那次加速几乎只发得出一轮；服务端真挂了的话
 * GET 同样失败，压到 3 秒只是把失败请求翻十倍。
 *
 * 不随页面可见性断开：连接闲置时只有 15 秒一次的心跳，成本远低于反复重连。
 */
export function useLiveStream() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    refCount += 1;
    open(mutate);
    return () => {
      refCount -= 1;
      if (refCount <= 0) {
        refCount = 0;
        close();
      }
    };
  }, [mutate]);
}
