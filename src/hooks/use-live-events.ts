"use client";

// 只要类型，实现在 open 里动态 import —— import type 编译后整条擦掉，不进 bundle
import type Pusher from "pusher-js";
import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
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
 * 只剩存活这一条：亲口离线要重取 declaredOffline；超时那条浏览器拿
 * lastSeenAt 现算，但优雅离开发生在心跳窗口内，本地钟还没走到。
 */
const INVALIDATIONS: ReadonlyArray<{
  event: LiveEvent["type"];
  paths: readonly string[];
}> = [
  // 上报器上下线：不带数据，只让它供数的那几张卡重取一次，换新的 declaredOffline
  { event: "presence", paths: PRESENCE_PATHS },
];

/**
 * 「此刻多少人在看这个页面」的缓存键。
 *
 * 不是路径，故意的 —— 它没有对应的 HTTP 端点，数字全靠推送写进来，所以也
 * 不在 lib/paths 那份路径常量里。键只在这个文件里用，外面读 useOnlineCount。
 */
const ONLINE_KEY = "live:online";

/** 连接通没通。同上，纯客户端的键。 */
const CONNECTION_KEY = "live:connected";

/** Pusher 协议自带的事件负载，字段名是协议定的，不归站点的 camelCase 约定管 */
type SubscriptionCount = { subscription_count: number };

/**
 * 整页共用一条连接。
 *
 * 现在有多个组件要读活动状态（Live Desk 的前台应用、Recently Played 的本机
 * 播放），如果每个都自己建一条 WebSocket，一个页面就会占掉好几条长连接。
 * 所以连接做成模块级单例，按订阅者数量开关。
 */
let client: Pusher | null = null;
let refCount = 0;

/**
 * 连接的代号，close() 每关一次 +1。
 *
 * pusher-js 是动态 import 来的（26KB 的实时推送不该躺在首屏的关键 chunk 里，
 * 这条连接本来就是挂载之后才需要的增强），于是 open 从同步变成了跨 await 的。
 * 跨过去之后世界可能已经变了：整页的订阅者在这期间全卸载、close() 已经跑完 ——
 * 那这次 open 就不作数了，再把 client 赋回去等于留下一条没人管、也没人关的
 * WebSocket。await 回来先对一遍代号，对不上就直接扔掉。
 */
let generation = 0;

/**
 * 有一次 open 正在等 import。
 *
 * 从前靠 `if (client) return` 挡住并发的第二次 open —— 那时 client 是同一个
 * 同步块里赋上的，第二个组件挂载时它已经在了。现在 client 要等 import 落地才有，
 * 同一轮 effect 里的两次 open 会双双穿过那个检查、各建一条连接。
 */
let opening = false;

function open(mutate: ScopedMutator) {
  if (client || opening) return;
  const endpoint = liveEndpoint();
  // 没配实时服务：卡片照常轮询，只是不会被推着翻。这一步留在 await 之前，
  // 没配的时候连那个 chunk 都不用去拉
  if (!endpoint) return;

  const selfHosted = "cluster" in endpoint ? null : endpoint;
  const transport: "ws" | "wss" = selfHosted?.tls ? "wss" : "ws";

  opening = true;
  const attempt = generation;

  void (async () => {
    try {
      // 拉不到 chunk（部署轮换、断网）就当没有实时推送：各卡照常轮询，
      // 下一次挂载还会再试一次。只吞这一步的失败，构造 Pusher 时的报错照旧抛
      const loaded = await import("pusher-js").catch(() => null);
      if (!loaded) return;
      // 等 import 的这段时间里关过：这次 open 已经作废，什么都别建
      if (attempt !== generation) return;

      const PusherJs = loaded.default;
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

      /**
       * 连接状态只喂给页脚那个说明浮层。
       *
       * 人数是推来的，断开之后它会停在最后一个值上 —— 不说一声的话，一个冻住的
       * 数字和实时的数字长得一模一样。
       *
       * 这不是把从前那个 connected 加回来（见下面 useLiveEvents 的注释）：那次去
       * 掉的是「断开时把各卡的轮询压到 3 秒」这个行为，不是不让人看见状态。
       */
      next.connection.bind("state_change", ({ current }: { current: string }) => {
        void mutate(CONNECTION_KEY, current === "connected", { revalidate: false });
      });

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

      /**
       * 在线人数单独绑，不进上面那两张表：那两张登记的是站点自己发的 LiveEvent，
       * 这条是 Pusher 协议自带的事件，塞进表里会把 LiveEvent["type"] 弄脏。
       *
       * 订阅成功时先给一次，之后人数每变一次推一次 —— 站点这侧不用加端点、不用
       * 轮询、也不用再开一条长连接。前提是 Pusher 后台「subscription counting」
       * 和「subscription count events」两个开关都开着，只开前者的话就只有 HTTP
       * API 能问、这里一条事件都收不到。
       */
      channel.bind("pusher:subscription_count", (payload: SubscriptionCount) => {
        void mutate(ONLINE_KEY, payload.subscription_count, { revalidate: false });
      });
    } finally {
      /**
       * 只有仍然是当前这一代才收旗。
       *
       * 中途 close 过的话 opening 已经被它清掉，而且很可能已经有新的一次 open
       * 举着这面旗在等自己的 import（组件卸载又立刻挂回来就是这个形状，
       * React 严格模式下每次挂载都会走一遍 mount → cleanup → mount）。
       * 不加这一句的话，作废的这一代会顺手把新那一代的旗放掉，
       * 于是下一个挂载的组件又能穿过 opening 检查，再建一条连接。
       */
      if (attempt === generation) opening = false;
    }
  })();
}

function close() {
  // 先换代号再断：在途的那次 open（如果有）await 回来会看到对不上，自行作废。
  // opening 也一并清掉，否则「关完再开」会被那面还举着的旗永久挡住
  generation += 1;
  opening = false;
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

/**
 * 此刻有多少人开着这个页面，以及那条连接此刻通不通。
 *
 * 人数数的是**订阅数**：一个标签页一条连接算一个，同一个人开两个标签页算两个。
 * 页面上有几张卡不影响 —— 整页共用一条连接（见上面 open 的注释）。
 * 连上之前、以及没配实时服务时 count 是 undefined。
 *
 * 两个键都不传 fetcher：它们没有端点可回源，只有推送会写。
 */
export function useOnlineCount(): { count: number | undefined; connected: boolean } {
  useLiveEvents();
  const { data: count } = useSWR<number>(ONLINE_KEY, null);
  const { data: connected } = useSWR<boolean>(CONNECTION_KEY, null);
  return { count, connected: connected ?? false };
}
