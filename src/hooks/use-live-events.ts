"use client";

import PusherJs from "pusher-js";
import { useEffect } from "react";
import { useSWRConfig } from "swr";
import type { ScopedMutator } from "swr";

import { mergeChargerHistory } from "@/lib/charger-history";
import { LIVE_CHANNEL, liveEndpoint } from "@/lib/live-channel";
import type { LiveEvent } from "@/lib/live-events";
import {
  CHARGER_PATH,
  DESKTOP_PATH,
  LISTENING_PATH,
  NOW_LISTENING_PATH,
  NOW_WATCHING_PATH,
  TIMEZONE_PATH,
  WATCHING_PATH,
} from "@/lib/paths";
import type { ChargerPayload, StatusResponse } from "@/lib/types";

/**
 * 事件名 → 写哪个 SWR 缓存键，以及写进去之前要不要先过一道合并。
 *
 * 四条以前是四段几乎一样的绑定，只有键和「要不要合并」不同。
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
  { event: "listening-now", path: NOW_LISTENING_PATH },
  // Emby 正在播放：webhook 和推送代理驱动，服务端手上已经是最新的
  { event: "watching-now", path: NOW_WATCHING_PATH },
  /**
   * 两张列表也直接带数据来。
   *
   * 从前它们只发失效通知、由这里 mutate 一次重取，理由是「整份太大」——
   * 实测 4.4 KB 和 2.8 KB，而重取要付的是每个在线标签页各一次回源。
   * 服务端那侧只在内容真的变了时才发，所以这两行不会退化成定时广播。
   */
  { event: "listening", path: LISTENING_PATH },
  { event: "watching", path: WATCHING_PATH },
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
 * 只有 Mac 上报器供数的那几张卡在列。Emby 正在看不在其中 —— 那条的数据来自
 * Emby 的 webhook 和 NAS 上的推送代理，和 Mac 上报器无关，Mac 睡了不影响你在
 * Emby 上看什么，跟着重取纯属白跑一趟。
 *
 * vibe coding 也不在：token 用量是累计的历史事实，Mac 掉线它不会变得不可信，
 * 只是不再增长，没有理由跟着变灰。
 */
const PRESENCE_PATHS = [DESKTOP_PATH, TIMEZONE_PATH, NOW_LISTENING_PATH, CHARGER_PATH];

/**
 * 不带数据的事件 → 收到后要重取哪几个键。
 *
 * 只剩存活这一条：它翻的是「上报器还在不在」，而各卡片的 stale 是服务端按各自
 * 的数据现算的，服务端没法在一条事件里把四份 payload 都算好推出来。
 */
const INVALIDATIONS: ReadonlyArray<{
  event: LiveEvent["type"];
  paths: readonly string[];
}> = [
  // 上报器上下线：不带数据，只让它供数的那几张卡重取一次，同时翻 stale
  { event: "presence", paths: PRESENCE_PATHS },
];

/**
 * 整页共用一条连接。
 *
 * 现在有多个组件要读活动状态（Live Desk 的前台应用、Recently Played 的本机
 * 播放），如果每个都自己建一条 WebSocket，一个页面就会占掉好几条长连接。
 * 所以连接做成模块级单例，按订阅者数量开关。
 */
let client: PusherJs | null = null;
let refCount = 0;

function open(mutate: ScopedMutator) {
  if (client) return;
  const endpoint = liveEndpoint();
  // 没配实时服务：卡片照常轮询，只是不会被推着翻
  if (!endpoint) return;

  const selfHosted = "cluster" in endpoint ? null : endpoint;
  const transport: "ws" | "wss" = selfHosted?.tls ? "wss" : "ws";

  const next = new PusherJs(endpoint.key, {
    // 自部署时 cluster 用不上，但 pusher-js 校验它必填，给个占位
    cluster: "cluster" in endpoint ? endpoint.cluster : "self-hosted",
    ...(selfHosted && {
      wsHost: selfHosted.host,
      wsPort: selfHosted.port,
      wssPort: selfHosted.port,
      forceTLS: selfHosted.tls,
      // 只留 WebSocket：自部署的地址没有云 Pusher 那套 HTTP 回退端点，
      // 让它去试只会在连不上时多打几个必然失败的请求
      enabledTransports: [transport],
    }),
  });
  client = next;

  const channel = next.subscribe(LIVE_CHANNEL);

  for (const { event, path, merge } of FORWARDS) {
    channel.bind(event, (payload: unknown) => {
      const envelope: StatusResponse<unknown> = {
        ok: true,
        data: merge ? merge(payload) : payload,
      };
      void mutate(path, envelope, { revalidate: false });
    });
  }

  for (const { event, paths } of INVALIDATIONS) {
    channel.bind(event, () => {
      for (const path of paths) void mutate(path);
    });
  }
}

function close() {
  client?.disconnect();
  client = null;
}

/**
 * 订阅服务端推送。
 *
 * 推来的活动状态直接写进 SWR 缓存，所以组件那边照旧用 useStatus 读，
 * 不用管数据是推来的还是轮询来的。收到的 payload 已经是解析好的对象。
 *
 * 不对外暴露连接状态。从前暴露了一个 connected，让几张卡在断开时把轮询从
 * 30 秒压到 3 秒 —— 但 pusher-js 自带断线重连（还带退避），断线基本几秒内
 * 自愈，那次加速几乎只发得出一轮；实时服务真挂了的话压到 3 秒也换不来新数据，
 * 只是把请求翻十倍。
 *
 * 不随页面可见性断开：连接闲置时只有协议自带的心跳，成本远低于反复重连。
 */
export function useLiveEvents() {
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
