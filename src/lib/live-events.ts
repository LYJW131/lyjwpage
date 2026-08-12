import { revalidateTag } from "next/cache";
import Pusher from "pusher";

import type { NowWatchingPayload, WatchingPayload } from "@/lib/emby";
import { LIVE_CHANNEL, liveEndpoint } from "@/lib/live-channel";
import type {
  ChargerPayload,
  DesktopPayload,
  ListeningPayload,
  NowListeningPayload,
} from "@/lib/types";

/**
 * 服务端 → 浏览器的实时推送。
 *
 * 走 Pusher 协议：遥测入口收到上报、状态落库之后，往实时服务发一次 HTTP
 * 请求就结束了，长连接全部挂在那边（自部署的 Sockudo 或云上的 Pusher）。
 * 本站因此不持有任何常驻连接，也就不要求自己是个常驻进程 —— 换成 serverless
 * 部署时这条链路一个字都不用改，连哪边只是环境变量的区别，见
 * [live-channel](src/lib/live-channel.ts)。
 *
 * 浏览器不需要往回发任何东西，所以是单向广播，公开频道就够，
 * 不碰 private channel 和那套鉴权。
 */

/**
 * 前台应用和播放拆成独立事件。播放来源可能是 MacBook 也可能是 HomePod，
 * 和「Mac 正在使用的应用」无关。
 *
 * 事件名和 /api/status/* 的路径一一对应：**`X` 是列表，`X/now` 是此刻**，
 * 事件这边写成 `X` 和 `X-now`。从前此刻那两条就叫 `listening` / `watching`，
 * 而同名的端点指的是列表，加上列表事件之后两套名字会正好错位。
 */
export type LiveEvent =
  | { type: "desktop"; payload: DesktopPayload }
  | { type: "listening-now"; payload: NowListeningPayload }
  /**
   * 「最近在听」列表变了，带整份数据。
   *
   * 这里曾经只发失效通知、让浏览器自己回来取，理由是「整份十几 KB，浏览器手上
   * 多半只差一两项」—— 两句都不对。实测 4.4 KB；而且发通知之后浏览器照样把整份
   * 取回来，字节一点没省，反倒多出一次请求头、一次往返、一个函数调用和一次
   * Redis 读，**并且是按在线人头乘的**。带数据推是严格更省的。
   *
   * 充电头那条不带历史点是另一回事：那是增量同步，服务端不知道各客户端的游标。
   * 列表是整份替换，没有游标这回事，不适用。
   *
   * 已知的天花板：Pusher 单条事件上限 10 KB，超了直接拒收、而 publish 只记一行
   * 日志，表现是这条推送静默消失、要等轮询兜底。当前 4.4 KB，两倍余量。
   */
  | { type: "listening"; payload: ListeningPayload }
  /**
   * 只在插拔、换设备这类结构性变化时发，不跟功率/电压/电流的滚动走 ——
   * 那些量充电时每个上报周期都在变，推它们等于把推送当轮询用。
   * 滚动读数仍由卡片自己的 SWR 轮询负责。
   *
   * 带完整状态但**不带历史点**：推送是广播，服务端不知道每个客户端的曲线
   * 游标，只能要么整份重发（400 个点约 15KB）要么不发。所以按「空增量」发 ——
   * `historyPartial: true` + 空数组，客户端沿用自己已有的曲线，端口和功率
   * 立刻更新。合并逻辑在 lib/charger-history，和轮询那条共用。
   */
  | { type: "charger"; payload: ChargerPayload }
  /**
   * 上报器上下线。只发失效通知 —— 存活是服务端的判断，各卡片重取自己的接口
   * 时会顺带拿到新的 stale，不必在这里把四份 payload 都算一遍推出去。
   *
   * 单独成一种事件，而不是借 desktop / listening 推：前端要能分清「上报器
   * 离线了」和「前台应用变了」，而且需要知道离线的不止那两张卡。
   */
  | { type: "presence"; payload: null }
  /**
   * Emby 正在播放。webhook 和推送代理驱动，服务端收到时手上就是最新的，
   * 所以直接带数据。
   */
  | { type: "watching-now"; payload: NowWatchingPayload }
  /** 「最近在看」列表变了。和上面那条 listening 同一个形状、同一个理由。实测 2.8 KB */
  | { type: "watching"; payload: WatchingPayload };

/**
 * 首屏服务端渲染那八份数据的缓存 tag。
 *
 * 名字和上面的事件名逐字相同，也就和 /api/status/* 的路径同一套：`X` 是列表、
 * `X-now` 是此刻，URL 里的 `/` 在名字里写成 `-`（AGENTS.md 第 2 条，路径常量在
 * lib/paths）。timezone 和 vibecoding 没有对应的推送事件 —— 那两张卡不靠推送
 * 翻面 —— 但按同一条规则取名，不为缓存另起一套。
 *
 * 摆在这个文件里，是因为失效和推送是同一个变化的两条腿：一条刷缓存给下一个
 * 访客，一条推给当前访客。名字和触发点挨着，改一条时另一条就在眼前。
 */
export const DESKTOP_TAG = "desktop";
export const TIMEZONE_TAG = "timezone";
export const CHARGER_TAG = "charger";
export const VIBECODING_TAG = "vibecoding";
export const LISTENING_TAG = "listening";
export const NOW_LISTENING_TAG = "listening-now";
export const WATCHING_TAG = "watching";
export const NOW_WATCHING_TAG = "watching-now";

/**
 * 让首屏缓存里的这几份过期，下一个请求重算。
 *
 * cacheComponents 下 revalidateTag 的第二个参数是必填的 —— 它是「失效之后旧的
 * 还能顶多久」。给 max 拿到的是 stale-while-revalidate：请求立刻拿到旧的那份、
 * 新的在后台重建，上报这条路径上一个字节都不用等。
 *
 * 和 publish 一样不往上抛：状态已经落库了，缓存没刷掉最多是下一个访客的首屏
 * 旧一点，卡片挂载后照样会自己回源纠正。
 */
export function expireStatus(...tags: string[]): void {
  for (const tag of tags) revalidateTag(tag, "max");
}

let client: Pusher | null = null;
let initialised = false;

/** 没配全凭据就一直是 null，只在第一次抱怨一句，不是每条事件都刷屏 */
function getClient(): Pusher | null {
  if (initialised) return client;
  initialised = true;

  const endpoint = liveEndpoint();
  const appId = process.env.PUSHER_APP_ID;
  const secret = process.env.PUSHER_SECRET;
  if (!endpoint || !appId || !secret) {
    console.warn("[live] 没配 Pusher 凭据，实时推送停用，页面只靠轮询更新");
    return null;
  }

  client = new Pusher({
    appId,
    secret,
    key: endpoint.key,
    ...("cluster" in endpoint
      ? { cluster: endpoint.cluster, useTLS: true }
      : // 自部署：发布用的 HTTP API 和浏览器连的 WebSocket 同一个地址同一个端口
        { host: endpoint.host, port: String(endpoint.port), useTLS: endpoint.tls }),
  });
  return client;
}

/**
 * 把事件交给实时服务。
 *
 * 失败只记一行日志，不往上抛：调用点都在 ingest 路由里、且**状态已经落库了**，
 * 推送丢一条页面靠轮询也能翻过来。为这个回 500 只会让上报器重试、把同一份
 * 数据再写一遍。
 *
 * 调用点一律 `await`：serverless 上响应一发出，没等完的后台工作随时可能被
 * 掐掉，fire-and-forget 会变成「偶尔推不出去」。
 */
export async function publish(event: LiveEvent): Promise<void> {
  const pusher = getClient();
  if (!pusher) return;

  try {
    await pusher.trigger(LIVE_CHANNEL, event.type, event.payload);
  } catch (error) {
    console.error("[live]", error instanceof Error ? error.message : String(error));
  }
}
