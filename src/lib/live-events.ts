import { revalidateTag } from "next/cache";
import Pusher from "pusher";

import type { NowWatchingPayload, WatchingPayload } from "@/lib/emby";
import { LIVE_CHANNEL, liveEndpoint } from "@/lib/live-channel";
import type {
  ChargerPayload,
  DesktopPayload,
  ListeningPayload,
  NowListeningPayload,
  VibeCodingSessionsPayload,
  PowerBankPayload,
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
  /** 充电宝：插拔、充放电切换、热控翻转、整数电量跳格时推一条 */
  | { type: "powerbank"; payload: PowerBankPayload }
  /**
   * 会话状态变了。只带扫描那四个字段，客户端并进手上已有的整份卡片。
   * 用量曲线和限额不走这里 —— 那是 10 分钟的事，推它们等于把推送当轮询用。
   */
  | { type: "vibecoding"; payload: VibeCodingSessionsPayload }
  /**
   * 上报器上下线。只发失效通知 —— 亲口离线是布尔值，得把新的
   * declaredOffline 取回来；超时那条浏览器拿手上的 lastSeenAt 自己就能翻。
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
 * lib/paths）。timezone 没有 status 端点、也没有推送事件，只给首屏用；
 * vibecoding 有推送，但只在会话状态变了时发，用量曲线仍靠轮询。
 *
 * 摆在这个文件里，是因为失效和推送是同一个变化的两条腿：一条刷缓存给下一个
 * 访客，一条推给当前访客。名字和触发点挨着，改一条时另一条就在眼前。
 */
export const DESKTOP_TAG = "desktop";
export const TIMEZONE_TAG = "timezone";
export const CHARGER_TAG = "charger";
export const POWERBANK_TAG = "powerbank";
export const VIBECODING_TAG = "vibecoding";
export const LISTENING_TAG = "listening";
export const NOW_LISTENING_TAG = "listening-now";
export const WATCHING_TAG = "watching";
export const NOW_WATCHING_TAG = "watching-now";

export const STATUS_TAGS = [
  DESKTOP_TAG,
  TIMEZONE_TAG,
  CHARGER_TAG,
  POWERBANK_TAG,
  VIBECODING_TAG,
  LISTENING_TAG,
  NOW_LISTENING_TAG,
  WATCHING_TAG,
  NOW_WATCHING_TAG,
] as const;

export type StatusTag = (typeof STATUS_TAGS)[number];

const STATUS_TAG_SET = new Set<string>(STATUS_TAGS);

export function isStatusTag(value: string): value is StatusTag {
  return STATUS_TAG_SET.has(value);
}

/**
 * 对端源站。`revalidateTag` 只打本部署的 `'use cache'`，Vercel 和 EdgeOne
 * 各有一份，共用 Redis 也刷不到对面。
 *
 * 只认 `STATUS_CACHE_PEERS`（逗号分隔，空字符串关掉）。两边各自配对面，
 * 不在代码里写死谁通知谁：Vercel 生产 `https://lyjw131.com`，EdgeOne
 * `https://lyjw.me`。没配就不通知，本地 dev 也因此不会去敲线上。
 */
function cachePeers(): string[] {
  const raw = process.env.STATUS_CACHE_PEERS;
  if (!raw) return [];
  return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function thisOriginHost(): string | null {
  const raw = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (!raw) return null;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).host;
  } catch {
    return null;
  }
}

function peerOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const self = thisOriginHost();
    if (self && url.host === self) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * 只刷本进程的 tag。对端入口必须走这一条，不能再调 expireStatus，否则两站互打。
 */
export function expireStatusLocally(tags: readonly string[], immediate = false): void {
  for (const tag of tags) {
    if (immediate) revalidateTag(tag, { expire: 0 });
    else revalidateTag(tag, "max");
  }
}

async function notifyCachePeers(tags: readonly string[], immediate: boolean): Promise<void> {
  const secret = process.env.TELEMETRY_INGEST_SECRET;
  const peers = cachePeers().map(peerOrigin).filter((origin): origin is string => origin != null);
  if (!secret || !peers.length || !tags.length) return;

  await Promise.all(
    peers.map(async (origin) => {
      try {
        const response = await fetch(`${origin}/api/ingest/revalidate`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ tags, immediate }),
          signal: AbortSignal.timeout(2_500),
        });
        if (!response.ok) {
          console.error("[live] peer revalidate", origin, response.status);
        }
      } catch (error) {
        console.error(
          "[live] peer revalidate",
          origin,
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );
}

/**
 * 让首屏缓存里的这几份过期，下一个请求重算。
 *
 * cacheComponents 下 revalidateTag 的第二个参数是必填的 —— 它是「失效之后旧的
 * 还能顶多久」。给 max 拿到的是 stale-while-revalidate：请求立刻拿到旧的那份、
 * 新的在后台重建，上报这条路径上一个字节都不用等。
 *
 * 对端也要等到：serverless 上响应一返回实例就冻住，fire-and-forget 会变成
 * 「国内那份偶尔没刷」。对端挂了只记一行，不把这次上报打成 400。
 */
export async function expireStatus(...tags: string[]): Promise<void> {
  expireStatusLocally(tags, false);
  await notifyCachePeers(tags, false);
}

/**
 * 立即让首屏缓存失效。
 *
 * 充电卡是否存在会改变首屏两列布局，实时播放则直接决定 LCP hero；这两份不能
 * 像普通文字数据一样先给下一位访客旧值再后台重建。上报来自 Route Handler，
 * 按 Next 16 的约定用 `{ expire: 0 }`；下一次页面请求只为指定 tag 阻塞重算。
 */
export async function expireStatusImmediately(...tags: string[]): Promise<void> {
  expireStatusLocally(tags, true);
  await notifyCachePeers(tags, true);
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
 * 失败只记一行日志，不往上抛：调用点都在 ingest 路由里，推送丢一条页面靠轮询
 * 也能翻过来。为这个回 500 只会让上报器重试、把同一份数据再写一遍。
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

/**
 * 一份还要现算的推送。算它可能要读另一个 store、查一次 Apple 目录，
 * 那些和写库互不相干，所以整个交给 fanout 去和写库并行。
 */
export type PendingEvent = LiveEvent | null | Promise<LiveEvent | null>;

export type Fanout = {
  /** 落库。**已经发车了的** promise —— fanout 只负责等，不负责启动 */
  writes?: ReadonlyArray<Promise<unknown>>;
  /** 带数据的推送 */
  events?: ReadonlyArray<PendingEvent>;
  /** 首屏缓存失效 */
  tags?: readonly string[];
  /** 同上，但不给旧值宽限期，见 expireStatusImmediately */
  urgentTags?: readonly string[];
};

/**
 * 一次上报的扇出：落库、推送、失效。
 *
 * 先后不是随便排的，两条规则：
 *
 * 1. **写库和带数据的推送同时做。** 推来的整份数据浏览器直接写进 SWR 缓存
 *    （`revalidate: false`，见 hooks/use-live-events），不会回头问服务端，
 *    所以它压根不关心那一刻 Redis 写完没有。串着做的话，Vercel 到 Redis 的那
 *    一个来回是白等的 —— 而这条链路上本来就已经压着好几个来回了。
 *
 *    前提是**推送的那份不能是从 Redis 读回来的**：读回来的话它当然得排在写
 *    之后。所以各处都改成拿手上现成的数据现拼，见各 store 的 prepare*。
 *
 * 2. **失效必须等写完。** revalidateTag 会让下一次请求回源重算，早于写库触发
 *    的话，重算读到的是改动之前的 Redis，然后把那个旧值连同一个崭新的有效期
 *    一起缓存起来 —— 比不失效还糟。不带数据、只让浏览器重取的事件（presence）
 *    同理，它触发的也是一次回源。
 *
 * 「同时」不是 fire-and-forget：一律 await 到底再返回，理由见 publish。
 */
export async function fanout({
  writes = [],
  events = [],
  tags = [],
  urgentTags = [],
}: Fanout): Promise<void> {
  try {
    await Promise.all([
      ...writes,
      ...events.map(async (pending) => {
        try {
          const event = await pending;
          if (event) await publish(event);
        } catch (error) {
          // 拼不出推送的那份不该把一次成功的上报变成 400 —— 数据照样落库了，
          // 页面靠轮询也能翻过来。和 publish 自己吞错误是同一个理由。
          console.error("[live]", error instanceof Error ? error.message : String(error));
        }
      }),
    ]);
  } finally {
    // 写抛出来了也照样失效：已经落库的那几份不该继续被旧缓存遮着
    if (tags.length) await expireStatus(...tags);
    if (urgentTags.length) await expireStatusImmediately(...urgentTags);
  }
}
