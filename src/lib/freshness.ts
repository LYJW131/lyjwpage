import type { NowListeningPayload } from "@/lib/types";

/**
 * 状态新鲜度：源站只盖时间戳，stale 由浏览器用自己的钟现算。
 *
 * 这些窗口必须前后端同一份 —— 源站 listening/now 现选 Hero 时用心跳窗口
 * （选择本身不进缓存），浏览器翻灰用的也是它。
 */

/**
 * Mac 上报器的心跳窗口：取上报器心跳间隔的三倍多一点。漏一条或 ingest 冷启动慢
 * 一点都不该翻掉线，连续三次没到才算崩溃 / 断网。优雅离开走 declaredOffline，
 * 不等这个窗口。
 *
 * 纯心跳是 /api/ingest/mac 的主要流量，窗口放宽是为了让上报器能降低心跳频率。
 * 这段窗口唯一换掉的是「崩溃 / 断网 / 强制关机」的判定延迟：关盖、睡眠、退出都走
 * declaredOffline，仍然是收到那一条就瞬时翻转，日常体验不变。
 *
 * ⚠️ 顺序不能反：**窗口先放宽，上报器再降频**。反过来做的话，中间那段时间上报器
 * 的间隔已经拉长、而站点还按旧窗口判，每一轮都踩在窗口边上，全站会断续显示离线。
 * 上报器那侧的间隔在 MacTelemetryHub 的 ServiceController 主循环里（心跳补发的
 * 那个下限），两边都改完才算改完。
 *
 * 服务端可用环境变量 HEARTBEAT_WINDOW_MS 覆盖 —— 已显式配置的环境不会随这里的
 * 默认值变化，数据后端的有效配置也要同步核对。浏览器用 payload 里盖上的那份，
 * 和充电头的 staleAfterMs 同一套。
 */
export const HEARTBEAT_WINDOW_MS = 300_000;

export function heartbeatWindowMs() {
  const configured = Number(process.env.HEARTBEAT_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : HEARTBEAT_WINDOW_MS;
}

/**
 * 各 agent 的限额由 NAS 上的容器上报器走 `/api/ingest/agents` 推，**每轮必发**
 * （内容没变也发，那一封就是心跳），所以「多久没刷新」等价于「上报器还活着没有」。
 * 上报器按页面人数分三档调频（`reporters/agents-reporter` 的 `LIVE_INTERVAL_MS` /
 * `OPEN_INTERVAL_MS` / `IDLE_INTERVAL_MS`）。窗口锚最慢的 idle 档：覆盖它的三轮，
 * 再加一段缓存余量。
 *
 * 上报器 `IDLE_INTERVAL_MS` 改长时，站点 `AGENT_LIMITS_STALE_MS` 必须跟着放宽。
 * 顺序同上面几条：**窗口先放宽，站点部署完，上报器再降频**。限额在可滞后层
 * （KV），每行带自己的更新时刻，过了这个阈值浏览器显示 Unavailable。
 */
export const AGENT_LIMITS_STALE_MS = 185 * 60_000;

/**
 * PlayStation 由 `reporters/playstation-reporter` 上报，**每个完整 tick 都发 presence**
 * （内容没变也发，那一封就是心跳），所以「多久没刷新」等价于「上报器还活着没有」。
 * 窗口取三轮多一点：漏一两轮不该让卡片翻脸，连着三轮没到才算容器死了、或者 PSN
 * 把它的令牌拒了。
 *
 * 一轮多久看局域网里的主机醒着没有（`reporters/playstation-reporter/src/cadence.ts`
 * 的 `AWAKE_TICK_INTERVAL_MS` / `IDLE_TICK_INTERVAL_MS`），不问页面人数。这个窗口
 * 锚的是**闲档**：主机醒着时只会更快，判活的下限始终由闲档决定。
 *
 * 闲档之外还要再宽一截：内容没变的心跳只落库、不广播，也不失效首屏，浏览器手里的
 * observedAt 要等下一次兜底轮询（推送连着时是 lib/poll-schedule 的
 * `PUSH_SAFETY_NET_MS`）才刷新，可能比存储里那份旧一个轮询周期。上报侧改闲档
 * （`IDLE_TICK_INTERVAL_MS`）时这里要跟着改。
 *
 * 只有浏览器判它（源站原样交出最后那份 presence，见 lib/playstation），所以没有
 * 服务端环境变量可调，要改窗口就改这个常量。这一路没有 declaredOffline 可用 ——
 * 容器悄悄死掉和主机关机长得一模一样，只能靠这个窗口分开，而分不开的那半
 * （到底在不在玩）就该老实说不知道，不是说不在线。
 */
export const PLAYSTATION_STALE_MS = 95 * 60_000;

/**
 * 服务器上报器按固定间隔推（`reporters/server-reporter` 的 `INTERVAL_MS`），
 * 每轮必发，所以「多久没刷新」等价于「上报器还活着没有」。
 *
 * 这份数据在可滞后层（KV，见 shared/lag.ts）：上报入口每封都重写、带上
 * `updatedAt`，浏览器拿它和这个阈值比，过了就显示 Unavailable，服务端不下结论。
 * 取十轮：漏几封不该翻脸，KV 跨机房的可见延迟也包在里面。
 * 上报器降频时**先放宽这里、站点部署完，再降频**。
 */
export const SERVER_STALE_MS = 10 * 60_000;

/**
 * 采集 Worker 写的可滞后层各块的过期阈值（节奏见 workers/collector/README.md 的任务表）。
 *
 * 每块带着自己的采集时刻（`fetchedAt` 或信封的 `updatedAt`），浏览器拿它和这里比，
 * 过了就不再拿旧数冒充此刻：卡片那一格回到「—」或 Unavailable。阈值取几轮采集的余量，
 * 漏一两轮、KV 跨机房的可见延迟都不翻脸；采集 Worker 停了、令牌失效时一两个阈值之内
 * 卡片就说实话。采集降频时**先放宽这里、站点部署完，再改采集节奏**。各块的节奏是
 * 对应 Job 的 `everyMinutes`（`workers/collector/src/jobs/`）。
 */
/** 厂商状态页（`providerStatusJob`） */
export const AGENT_STATUS_STALE_MS = 10 * 60_000;
/** GitHub 贡献日历（`githubChartJob`）；日历按天变，放得最宽 */
export const GITHUB_CHART_STALE_MS = 6 * 3_600_000;
/** 本仓库统计（`githubRepoJob`）；push 后 GitHub 现算统计时会连着几轮 202 */
export const GITHUB_REPO_STALE_MS = 3 * 3_600_000;
/** Vercel 生产版本与最近部署（`vercelDeploymentsJob`） */
export const VERCEL_DEPLOYMENTS_STALE_MS = 10 * 60_000;
/** Vercel 函数与访问统计（`vercelMetricsJob`），两组各带采集时刻 */
export const VERCEL_METRICS_STALE_MS = 3_600_000;
/** PageSpeed 实验室分（`pagespeedJob`）；按最近一轮实测的时刻算 */
export const PAGESPEED_STALE_MS = 3 * 3_600_000;
/** 各 Worker 部署的版本与提交（`cloudflareDeploymentsJob`） */
export const CLOUDFLARE_DEPLOYMENTS_STALE_MS = 15 * 60_000;
/** 各 Worker 的调用统计（`cloudflareMetricsJob`） */
export const CLOUDFLARE_METRICS_STALE_MS = 3_600_000;
/** Sentry 在线探测、心跳、错误数、真实访客指标（`sentryStatusJob`）；各块按自己取到的时刻算 */
export const SENTRY_STALE_MS = 30 * 60_000;

/**
 * 活动圆环读数（可滞后层，iPhone 上报入口写）多久没刷新就不再当此刻展示。
 *
 * iPhone 上报器不常驻，只有 HealthKit 有新样本才把它唤起（`reporters/iphone-telemetry-hub`
 * 的 README「什么时候会上报」）：戴着表活动时圆环这条后台投递被系统按小时节流；内容
 * 没变就不发，隔满 `TelemetryHub.refresh` 的那次唤醒才整份重发。睡觉、表在充电时没有
 * 新样本，一整夜一封都没有 —— 那时圈冻在睡前那一份是对的（跨过午夜那一下由
 * currentAtSource 判成「昨天」）。所以正常的最长空档就是一夜，阈值取一夜加余量不误报；
 * 过了还没有新的，就是手机那头没在报（没电、关机、权限被收），卡片那一格写 Unavailable、
 * 读数回到「—」，不拿一份停住的圈冒充此刻。
 *
 * 训练列表**不设**这样的阈值：完成过的训练是历史事实，手机多久没报它们也不会变假，
 * 顶多是缺了之后的新训练（那是不完整，不是错）。所以训练条目一直照画。
 */
export const ACTIVITY_STALE_MS = 12 * 3_600_000;

/**
 * `at` 这一刻，UTC 偏移为 `secondsFromGMT` 的地方是哪一天（YYYY-MM-DD）。
 *
 * 服务端在取数出口据此盖 `currentAtSource`（lib/activity 的 withActivityFreshness），
 * 卡片直接读那个字段，浏览器不用再算一遍。
 */
export function localDate(at: number, secondsFromGMT: number): string {
  return new Date(at + secondsFromGMT * 1000).toISOString().slice(0, 10);
}

/** 充电头 / 充电宝这一路的断流窗口默认值：上报间隔的三倍没消息就算断了。服务端可用环境变量加长。 */
export const CHARGER_STALE_MS = 90_000;

export type FreshnessInput = {
  /**
   * 访客钟。首帧用首屏信封的 servedAt（服务端预渲染和 hydrate 读的是同一个值）；
   * 连那个也没有时传 0，不当过期，避免和服务端 HTML 对不上。
   */
  now: number;
  /** 源站盖章的到来时刻。0 / 缺省 = 从没见过 */
  at: number | null | undefined;
  windowMs: number;
  /** 上报器亲口说走了：不是时间函数，立刻算过期 */
  declaredOffline?: boolean;
};

/**
 * 这份快照现在算不算过期。
 *
 * `now === 0` 是首屏哨兵（见 useMountedAt）：首帧既没有访客钟、信封里也没有
 * servedAt 时，除了亲口离线以外都不判过期，否则服务端 HTML 和 hydrate 会各画各的。
 */
export function isStale({ now, at, windowMs, declaredOffline = false }: FreshnessInput) {
  if (declaredOffline) return true;
  if (!now) return false;
  if (at == null) return false;
  if (at <= 0) return true;
  return now - at > windowMs;
}

/**
 * 访客钟此刻的读数（hooks/use-stale 的 useClock）。
 *
 * 首帧（服务端预渲染和 hydrate，`mountedAt` 为 0）读首屏那份信封的 `servedAt`：
 * 两边读到同一个值，判出来的是填缓存那一刻源站会下的结论。挂载后换成挂载那一刻，
 * 推过钟之后是推钟的时刻。三样都没有是 0，isStale 把它当「没有钟」，什么都不判。
 *
 * **只进不退**：取三者最大。访客的钟比源站慢时，挂载那一刻会早于 servedAt，
 * 直接换过去钟就倒退了 —— 首帧按 servedAt 判出、已经按住的过期会被这一退松开，
 * 等访客的钟追上来再翻回去。停在 servedAt 等它追上，判的仍是源站当时的结论。
 */
export function clockReading(ticked: number, mountedAt: number, servedAt: number | undefined): number {
  return Math.max(ticked, mountedAt, servedAt ?? 0);
}

/** 访客钟该怎么往前推（hooks/use-stale 的 useClock） */
export type ClockAdvance =
  /** 没有晚于钟的 deadline，不用推 */
  | { kind: "idle" }
  /** 有 deadline 在真实时间里已经过了：马上推，推到 `to` 与此刻里较晚的那个 */
  | { kind: "now"; to: number }
  /** 最早那个 deadline（`to`）还没到：这么多毫秒之后推 */
  | { kind: "later"; delayMs: number; to: number };

/** 有没有晚于钟的 deadline。没有的话，这把钟对手上这份数据来说就是准的 */
export function hasPendingDeadline(clock: number, deadlines: readonly (number | null)[]): boolean {
  return deadlines.some((at) => at != null && at > clock);
}

/**
 * 访客钟下一步怎么推。
 *
 * `clock` 是手上那把钟此刻的读数，`realNow` 是 Date.now()。钟只在 deadline 处往前推，
 * 所以**凡是晚于 clock 的 deadline 都得处理** —— 包括真实时间里其实已经过了的：
 * 新数据带来的 deadline 可能正好落在「钟」和「此刻」之间（后台标签页回来时 Mac
 * 早已悄悄断了、轮询在 deadline 和定时器之间换了 lastSeenAt），不管它的话钟就停在
 * 原地，这份数据永远判不出过期。
 *
 * 已经过了的立刻推（下一个任务就推，不再多等）；在推上去之前，这把钟对这份
 * 数据不作准（useClock 的 settled 为假），按住的过期不因为钟慢而松开 —— 否则会先
 * 按新鲜画一帧，看上去离线 → 在线 → 离线闪一下。还没到的排定时器，多等一小会儿免得
 * 早醒一点白跑。
 *
 * 推到哪：此刻与那个 deadline（`to`）里较晚的那个。只读 Date.now() 的话，系统时钟往回
 * 调过（NTP 校时、手动改钟）时推出来的读数可能不比钟大，钟停在原地、deadline 一直
 * 挂着；推到 deadline 至少保证它被跨过去，不会再被处理一次。
 */
export function clockAdvance(
  clock: number,
  deadlines: readonly (number | null)[],
  realNow: number,
): ClockAdvance {
  const pending = deadlines.filter((at): at is number => at != null && at > clock);
  if (!pending.length) return { kind: "idle" };
  const to = Math.min(...pending);
  if (to <= realNow) return { kind: "now", to };
  return { kind: "later", delayMs: to - realNow + 250, to };
}

/**
 * 切回前台之后、那次回源回来之前的这段（hooks/use-stale 的 useConfirmedStale）。
 *
 * 页面从后台回来那一刻，usePageActive 先翻（微任务），SWR 的切回前台回源要再晚一拍
 * 才开始，中间有一次渲染是「在前台、不在回源」—— 这时按钟判的过期只说明后台那段
 * 没人去问，不能当真，否则每次切回都先闪一下离线、收一下充电格，回源回来再复原。
 * 所以把「刚切回来」到「下一次回源开始又结束」这段也当作回源途中。
 */
export type ResumeState = {
  /** 上一次渲染时页面在不在前台 */
  active: boolean;
  /** 刚切回前台，还在等那次回源 */
  resuming: boolean;
  /** 等的这段里已经见过回源开始 */
  sawValidating: boolean;
};

export function resumeStep(
  state: ResumeState,
  { active, validating }: { active: boolean; validating: boolean },
): ResumeState {
  if (!active) {
    return state.active || state.resuming || state.sawValidating
      ? { active: false, resuming: false, sawValidating: false }
      : state;
  }
  if (!state.active) return { active: true, resuming: true, sawValidating: validating };
  if (!state.resuming) return state;
  if (validating) return state.sawValidating ? state : { ...state, sawValidating: true };
  // 回源开始过、现在结束了：等的那一次回来了
  return state.sawValidating ? { active: true, resuming: false, sawValidating: false } : state;
}

/**
 * 等不来回源（SWR 切回前台的回源有节流，几秒内切两次第二次不发）：过了这么久还没
 * 见到回源开始，就不再等，按手上的判。
 */
export const RESUME_REFETCH_GRACE_MS = 1_000;

export function resumeTimedOut(state: ResumeState): ResumeState {
  return state.resuming && !state.sawValidating ? { ...state, resuming: false } : state;
}

export type StaleHoldInput = {
  /** 按钟判是不是过期了 */
  stale: boolean;
  /** 页面在前台 */
  active: boolean;
  /** 这份数据所在的 SWR 键正在回源（含刚切回前台、回源还没开始的那一拍） */
  validating: boolean;
  /**
   * 钟对手上这份数据作不作准：新数据带来的 deadline 晚于钟、还没核对是不是已经
   * 过了时为假。那时的「不过期」可能只是钟慢了，不能拿它松开按住的过期。
   */
  settled?: boolean;
};

/**
 * 按钟判出来的过期要不要当真（hooks/use-stale 的 useConfirmedStale 的纯逻辑）。
 *
 * 返回新的「按住」状态和此刻该显示的结论：
 *
 * - 不过期了（推送或轮询送来了新数据）才松开，这是唯一的松开条件，而且要等钟
 *   对新数据作准了（settled）才算数。页面退到后台
 *   **不松**：否则每次切走再切回，已经断了的那路都会先被当成活的画一遍（充电格
 *   重新展开、正在听换回死掉的那台 Mac、跟听在后台跟着它重排）。
 * - 新的确认只在页面在前台、且不在回源途中时发生：回源途中手上这份可能正要被
 *   换掉（首屏 HTML 冻了好几分钟、标签页刚从后台回来），先等它回来再判。
 * - 已经按住的，回源途中和后台都照旧显示过期，每一轮轮询不会把它闪回去。
 */
export function confirmStale(
  held: boolean,
  { stale, active, validating, settled = true }: StaleHoldInput,
): { held: boolean; stale: boolean } {
  if (!stale) return held && !settled ? { held: true, stale: true } : { held: false, stale: false };
  const next = held || (active && !validating);
  return { held: next, stale: next };
}

/**
 * 充电头 / 充电宝那一路判活要用的字段：Mac 上报器的存活，加上这一路自己多久没续上。
 *
 * 类型只取 ReporterPresence 那三项，不 import 存活模块 —— 那边连着存储，客户端组件
 * 引不得。
 */
export type ChargingFeed = {
  connected: boolean;
  /** 源站最近一次收到这一路（或替它续上的心跳）的时刻 */
  pushedAt: number;
  staleAfterMs: number;
  lastSeenAt: number;
  declaredOffline: boolean;
  heartbeatWindowMs: number;
};

/**
 * 按访客钟，这一路的读数是不是已经断了：Mac 上报器心跳窗口过了，或这一路自己
 * 太久没续上。**不含亲口离线** —— 那不是时间函数，由 liveChargingFeed 直接认。
 *
 * 分开是因为两者能用的时机不同：按钟判出来的过期在挂载后那一次回源回来之前
 * 不作数（首屏 HTML 可能冻了好几分钟），亲口离线首帧就作数。
 */
export function chargingFeedClockStale(feed: ChargingFeed, now: number): boolean {
  return (
    isStale({ now, at: feed.lastSeenAt, windowMs: feed.heartbeatWindowMs }) ||
    isStale({ now, at: feed.pushedAt, windowMs: feed.staleAfterMs })
  );
}

/**
 * 把判活结果盖回 `connected`：上报器亲口离线、或按钟已经断流，就当没连着。
 *
 * 源站只给原样的 `connected` 和几个时刻，判活在浏览器，卡片和 media-pair 的排版
 * 都过这一道，谁也不各算各的。`clockStale` 由调用方给（hooks/use-stale 的
 * useLiveChargingFeed 按访客钟算、并挡掉回源途中那段）；首帧拿首屏信封的 servedAt
 * 当钟，用 chargingFeedClockStale 算。
 */
export function liveChargingFeed<T extends ChargingFeed>(feed: T, clockStale: boolean): T {
  const connected = feed.connected && !feed.declaredOffline && !clockStale;
  return connected === feed.connected ? feed : { ...feed, connected };
}

/**
 * 「正在听」：选中的是 Mac 那首、而 Mac 已经掉线时，换成 `alternate`（HomePod 还在放
 * 的那首），没有就当没在放。选中的是 HomePod 时原样返回 —— HomePod 不看 Mac 的存活。
 *
 * `macOffline` 由调用方按 payload 里的 Mac 存活判（hooks/use-stale 的
 * useLiveNowListening）。源站选的那一次只在取数那一刻成立，见 pickNowListening。
 */
export function liveNowListening(payload: NowListeningPayload, macOffline: boolean): NowListeningPayload {
  if (!macOffline || payload.music?.source !== "apple-music") return payload;
  const next = payload.alternate;
  return {
    ...payload,
    music: next?.music ?? null,
    idle: !next,
    id: next?.id ?? null,
    link: next?.link ?? null,
    songId: next?.songId ?? null,
    upcomingSongIds: next?.upcomingSongIds ?? [],
    hasLyrics: next?.hasLyrics ?? false,
    // 到期的是 Mac 那首的暂停宽限；接班的只收在放的，没有宽限可等
    expiresInMs: null,
    alternate: null,
  };
}
