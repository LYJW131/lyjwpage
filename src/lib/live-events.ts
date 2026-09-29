import type { NowWatchingPayload, WatchingPayload } from "@/lib/emby";
import type { QuestNow } from "@shared/quest";
import type {
  ChargerPayload,
  CodingNowPayload,
  DesktopPayload,
  ListeningPayload,
  NowListeningPayload,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  TrophiesSummaryPayload,
  PowerBankPayload,
} from "@/lib/types";

/** Worker → 浏览器的事件契约。发布实现仅在 workers/api/src/fanout.ts。 */

/**
 * 前台应用和播放拆成独立事件。播放来源可能是 MacBook 也可能是 HomePod，
 * 和「Mac 正在使用的应用」无关。
 *
 * 事件名和 /api/status/* 的路径一一对应：**`X` 是列表，`X/now` 是此刻**，
 * 事件这边写成 `X` 和 `X-now`。
 */
export type LiveEvent =
  | { type: "quest-now"; payload: QuestNow }
  | { type: "desktop"; payload: DesktopPayload }
  | { type: "listening-now"; payload: NowListeningPayload }
  /**
   * 「最近在听」列表变了，带整份数据：只发失效通知的话，浏览器照样要把整份取回来，
   * 反倒多出一次往返，**并且是按在线人头乘的**。带数据推是严格更省的。
   *
   * 充电头那条不带历史点是另一回事：那是增量同步，服务端不知道各客户端的游标。
   * 列表是整份替换，没有游标这回事，不适用。单条消息受 Cloudflare WebSocket
   * 消息上限约束，列表整份要保持在其内。
   */
  | { type: "listening"; payload: ListeningPayload }
  /**
   * 在插拔、换设备这类结构性变化时发，以及那之后的收敛窗口里（判据见
   * lib/charging-settling）：采集端在那段时间会追发，功率还在往稳定值收敛。
   * 平时不跟功率/电压/电流的滚动走 —— 那些量充电时每个上报周期都在变，推它们
   * 等于把推送当轮询用，滚动读数仍由卡片自己的 SWR 轮询负责。
   *
   * 带完整状态但**不带历史点**：推送是广播，服务端不知道每个客户端的曲线
   * 游标，只能要么整份重发要么不发。所以按「空增量」发 ——
   * `historyPartial: true` + 空数组，客户端沿用自己已有的曲线，端口和功率
   * 立刻更新。合并逻辑在 lib/charger-history，和轮询那条共用。
   */
  | { type: "charger"; payload: ChargerPayload }
  /** 充电宝：发送时机同充电头（结构性变化及其后的收敛窗口）；整份快照，没有历史曲线 */
  | { type: "powerbank"; payload: PowerBankPayload }
  /**
   * coding agent 此刻：某个来源报来的最近用量事件变了。带整份 `/api/status/coding/now`，
   * 直接写进那个 SWR 键。用量、排名、年度不走这里：那些是累计量，推它们等于把推送当轮询用。
   */
  | { type: "coding-now"; payload: CodingNowPayload }
  /**
   * 上报器上下线。只发失效通知 —— 亲口离线是布尔值，得把新的
   * declaredOffline 取回来；超时那条浏览器拿手上的 lastSeenAt 自己就能翻。
   *
   * 单独成一种事件，而不是借 desktop / listening 推：前端要能分清「上报器
   * 离线了」和「前台应用变了」，而且需要知道离线的不止那两张卡。
   *
   * 唯一的发出点是 workers/api/src/stores/telemetry 的 commitPreparedTelemetryEnvelope
   * （存活只在那里翻转），走 fanout 的 `notify` 那半 —— 它不带数据，浏览器收到就回源，
   * 所以必须排在写后面（workers/api/src/fanout.ts 先等 writes 落库再发布）。浏览器那侧
   * 重取哪几份见 hooks/use-live-events 的 PRESENCE_PATHS：coding 只重取此刻那份（活动灯里
   * mac 那一路靠它在优雅离开时立刻熄），用量是累计的历史事实，Mac 掉线不会让它变假。
   */
  | { type: "presence"; payload: null }
  /**
   * 站点新部署接管了生产域名，并且 ESA 首页已刷新。只发失效通知：浏览器收到后
   * 重问同源的 `/api/version`（不是 `/api/status/*`，事件名按同一规则取 `version`）。
   * 不带 sha —— 回滚、别名切换时只有域名上那次部署自己答得准。
   *
   * 唯一的发出点是上报入口 Worker 的 `/api/internal/site-deployed`（转给状态核心广播），
   * 由 GitHub Actions（.github/workflows/purge-esa.yml）在确认两个域名都答新 sha 之后调用。
   */
  | { type: "version"; payload: null }
  /**
   * 此刻可见的页面数变了（页脚的「Online now」）。推送房间自己数、自己发，见
   * workers/api/src/live-census.ts；页面接入时也单独收到一条当前值。
   *
   * 不守「事件跟随状态 URL」那条命名规则：人数没有 `/api/status/*` 端点，
   * 对外的读口是 Worker 的 `/count`，事件名就叫它的字段名。
   */
  | { type: "online"; payload: { online: number } }
  /**
   * Emby 正在播放。webhook 和推送代理驱动，服务端收到时手上就是最新的，
   * 所以直接带数据。
   */
  | { type: "watching-now"; payload: NowWatchingPayload }
  /** 「最近在看」列表变了。和上面那条 listening 同一个形状、同一个理由。 */
  | { type: "watching"; payload: WatchingPayload }
  /** PlayStation 此刻在线 / 在玩状态。 */
  | { type: "playing-now"; payload: PlaystationPresencePayload }
  /** PlayStation 最近游玩列表；整份替换，直接写进浏览器 SWR 缓存。 */
  | { type: "playing"; payload: PlaystationPlayingPayload }
  /**
   * PlayStation 奖杯变了（解锁、新 DLC、等级）。带的是摘要 —— 等级、合计、最近
   * 解锁、各款进度，和 `/api/status/trophies` 无参回的同一份。
   * 整份目录每个奖杯都带说明和图标，体积大还要乘在线人头，不推；展开着的
   * 瓷砖收到这条自己去重取那一两款的切片。
   */
  | { type: "trophies"; payload: TrophiesSummaryPayload };

/**
 * 状态 tag 常量在 lib/status-tags，这里原样再导出：失效和推送是同一个变化的两条腿，
 * 各 store 从这一个模块拿事件名和 tag 名。
 */
export {
  ACTIVITY_TAG,
  CHARGER_TAG,
  CODING_NOW_TAG,
  CODING_TAG,
  CODING_YEAR_TAG,
  DESKTOP_TAG,
  LIMITS_TAG,
  LISTENING_TAG,
  NOW_LISTENING_TAG,
  NOW_PLAYING_TAG,
  NOW_WATCHING_TAG,
  PLAYING_TAG,
  POWERBANK_TAG,
  SERVER_TAG,
  STATUS_TAGS,
  TIMEZONE_TAG,
  TROPHIES_TAG,
  WATCHING_TAG,
} from "@/lib/status-tags";
