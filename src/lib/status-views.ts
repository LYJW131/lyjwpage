/**
 * 公开状态视图的唯一登记表。
 *
 * 一个视图 = 一条 `/api/status/*` 公开端点。它在两侧的所有名字都从这里派生：
 * 端点路径、Vercel 首屏缓存标签（`page:<tag>`）、WebSocket 事件名、所在的数据层。
 * 以前这些名字分散在七八张手写表里，新加一张卡要改十个文件，而且表和表之间没有
 * 编译期约束。现在只加这里一行，其余各处按 key 取。
 *
 * 这个文件必须保持同构：浏览器（SWR 键、推送分发、挂载校验）和 Worker 都会 import，
 * 所以只放元数据，不放取数函数。服务端 loader 按同一组 key 登记在
 * `src/lib/status-loaders.ts`，两张表由 `satisfies Record<StatusViewKey, …>` 强制对齐。
 *
 * 命名规则（见 AGENTS.md「API 命名与跨端契约」）：`X` 是列表 / 历史，`X/now` 是此刻；
 * 事件名跟随路径、`/` 换成 `-`。`vibecoding-now` 是唯一的例外：它只推「此刻」那几个
 * 字段、并进 `/api/status/vibecoding` 整份里，没有独立端点。
 */

/**
 * 数据层（见重构方案「两层数据」）：
 * - `realtime`：状态核心 DO 是权威，变了立刻推、读到必是最新，或参与 pulse 计算。
 *   首屏按卡读取后，页面打开时每张实时卡各自回源校验一次，补上 HTML 生成后到推送
 *   连上之间的空窗。
 * - `lag`：可滞后层。写入方直接写 KV、不推送；每份带 `updatedAt`，过没过时由浏览器
 *   按该卡的阈值判断。页面打开后直接用首屏那份，之后在「下一次预期写入」时取
 *   （`updatedAt + cadenceMs + 宽限`，见 lib/poll-schedule），不按固定间隔轮询。
 */
export type StatusLayer = "realtime" | "lag";

export type StatusView = {
  path: `/api/status/${string}`;
  layer: StatusLayer;
  /** Vercel 首屏缓存标签（不带 `page:` 前缀）。没有的视图变化不触发首屏重建。 */
  tag?: string;
  /**
   * 带数据的推送事件名。收到后直接写进该视图的 SWR 键。
   * 只有实时层能推：可滞后层的写入方不推送，模块加载时断言。
   */
  event?: string;
  /**
   * 可滞后层：写入方的标称节奏（毫秒）。浏览器在 `updatedAt + cadenceMs` 之后几秒去取，
   * 节奏改了只改这里。一份视图由几块不同节奏拼成时取最快那块（慢块在它那轮顺带更新）。
   * 不填 = 首屏之后不轮询（只靠切回焦点）。
   */
  cadenceMs?: number;
  /**
   * 实时层：推送连着时轮询能不能退成 5 分钟一次的兜底。只有推送带着整份、且卡片没有
   * 按钟判的心跳（lastSeenAt 只随轮询刷新、不推）也没有只靠轮询滚动的读数时才开。
   */
  pushCovers?: true;
};

export const STATUS_VIEWS = {
  desktop: { path: "/api/status/desktop", layer: "realtime", tag: "desktop", event: "desktop" },
  /** Mac 时区模块；没有推送，首屏那份之后不再轮询 */
  timezone: { path: "/api/status/timezone", layer: "lag", tag: "timezone" },
  /** iPhone 上报器：HealthKit 后台投递被系统钳到每小时一封（reporters/iphone-telemetry-hub README） */
  workouts: { path: "/api/status/workouts", layer: "lag", tag: "workouts", cadenceMs: 3_600_000 },
  /** 圆环读数；五分钟统计桶另走 pulse，归实时层 */
  activity: { path: "/api/status/activity", layer: "lag", tag: "activity", cadenceMs: 3_600_000 },
  /** 服务器上报器每分钟一推（reporters/server-reporter 的 INTERVAL_MS）；服务器卡与 LYJWPAGE 卡共用这个键 */
  server: { path: "/api/status/server", layer: "lag", tag: "server", cadenceMs: 60_000 },
  charger: { path: "/api/status/charger", layer: "realtime", tag: "charger", event: "charger" },
  powerBank: { path: "/api/status/powerbank", layer: "realtime", tag: "powerbank", event: "powerbank" },
  listening: { path: "/api/status/listening", layer: "realtime", tag: "listening", event: "listening", pushCovers: true },
  nowListening: { path: "/api/status/listening/now", layer: "realtime", tag: "listening-now", event: "listening-now" },
  vibeCoding: { path: "/api/status/vibecoding", layer: "realtime", tag: "vibecoding", event: "vibecoding-now" },
  /** 各 agent 账号的套餐与限额窗口；浏览器按 id 贴回 vibecoding 的用量行 */
  limits: { path: "/api/status/limits", layer: "lag", tag: "limits", cadenceMs: 5 * 60_000 },
  /** 厂商状态页。采集 Worker 每分钟拉官方 JSON / RSS 写 KV，不推送 */
  agentStatus: { path: "/api/status/agent-status", layer: "lag", tag: "agent-status", cadenceMs: 60_000 },
  /** Mac 上报器随用量推；信封不带 updatedAt，按这个间隔取（云端可能回填旧日） */
  vibeCodingYear: { path: "/api/status/vibecoding/year", layer: "lag", tag: "vibecoding-year", cadenceMs: 6 * 3_600_000 },
  watching: { path: "/api/status/watching", layer: "realtime", tag: "watching", event: "watching", pushCovers: true },
  nowWatching: { path: "/api/status/watching/now", layer: "realtime", tag: "watching-now", event: "watching-now", pushCovers: true },
  playing: { path: "/api/status/playing", layer: "realtime", tag: "playing", event: "playing", pushCovers: true },
  /** 在线判定按 observedAt 与 95 分钟窗口（PLAYSTATION_STALE_MS），5 分钟兜底足够 */
  playingNow: { path: "/api/status/playing/now", layer: "realtime", tag: "playing-now", event: "playing-now", pushCovers: true },
  /**
   * 无参端点、首屏、推送三者同是摘要（TrophiesSummaryPayload，实测 8 KB 级）；
   * 带 `?titleids=` 才是那几款的完整目录（TrophiesPayload），展开瓷砖时取。
   */
  trophies: { path: "/api/status/trophies", layer: "realtime", tag: "trophies", event: "trophies", pushCovers: true },
  /** 以下采集 Worker 写的节奏见 workers/collector/README.md 的任务表 */
  /** github-chart：每 10 分钟 · 第 1 分钟 */
  githubChart: { path: "/api/status/github-chart", layer: "lag", cadenceMs: 10 * 60_000 },
  /** github-repo：每 30 分钟 · 第 2 分钟 */
  githubRepo: { path: "/api/status/github-repo", layer: "lag", cadenceMs: 30 * 60_000 },
  /** 各 Worker 当前部署的版本与构建提交（每 2 分钟）、12 小时调用统计（15 分钟），取快的那块 */
  cloudflareWorkers: { path: "/api/status/cloudflare-workers", layer: "lag", cadenceMs: 2 * 60_000 },
  /** 部署每分钟、指标 15 分钟、PageSpeed 每小时，取最快的部署那块 */
  vercelDeployments: { path: "/api/status/vercel-deployments", layer: "lag", cadenceMs: 60_000 },
  /** 在线状态、错误量与真实访客指标，来自 Sentry */
  sentry: { path: "/api/status/sentry", layer: "lag", cadenceMs: 5 * 60_000 },
  /** 常驻上报器报来的账本：12 小时推成功几封、跑的哪个提交 */
  /** 账本随每封上报重写，最勤的是服务器上报器的每分钟一封 */
  reporters: { path: "/api/status/reporters", layer: "lag", cadenceMs: 60_000 },
  /** 最近 24 小时的事实时间线；由状态核心从实时层算出，不推送、每 5 分钟轮询 */
  pulse: { path: "/api/status/pulse", layer: "realtime" },
} as const satisfies Record<string, StatusView>;

export type StatusViewKey = keyof typeof STATUS_VIEWS;
/** 每个视图都有自己的端点；保留这个名字给按端点取数的调用方 */
export type EndpointViewKey = StatusViewKey;
export type StatusPath = (typeof STATUS_VIEWS)[StatusViewKey]["path"];

export const STATUS_VIEW_KEYS = Object.keys(STATUS_VIEWS) as StatusViewKey[];

function entries(): [StatusViewKey, StatusView][] {
  return Object.entries(STATUS_VIEWS) as [StatusViewKey, StatusView][];
}

/** 全部视图，按登记顺序 */
export function endpointViews(): [StatusViewKey, StatusView][] {
  return entries();
}

const KEY_BY_PATH = new Map<string, EndpointViewKey>(endpointViews().map(([key, view]) => [view.path, key]));
/** 路径 → 视图 key；不认识的路径（歌词、令牌、带前缀写错的）返回 undefined */
export function viewKeyByPath(path: string): EndpointViewKey | undefined {
  return KEY_BY_PATH.get(path);
}

/** 该路径所在的数据层；不认识的路径（歌词、令牌）按实时层处理，挂载时照常回源 */
export function layerOfPath(path: string): StatusLayer {
  const key = viewKeyByPath(path);
  return key ? (STATUS_VIEWS[key] as StatusView).layer : "realtime";
}

const PATH_BY_EVENT = new Map<string, string>(
  entries().flatMap(([, view]) => (view.event && view.path ? [[view.event, view.path]] : [])),
);
/** 事件名 → 该事件写入的端点路径（也就是 SWR 键）；`presence` 这种不带数据的事件没有 */
export function pathByEvent(event: string): string | undefined {
  return PATH_BY_EVENT.get(event);
}

function viewOfPath(path: string): StatusView | undefined {
  const key = viewKeyByPath(path.split("?")[0]);
  return key ? (STATUS_VIEWS[key] as StatusView) : undefined;
}

/** 可滞后层视图写入方的标称节奏；实时层、不认识的路径或不轮询的视图返回 undefined */
export function cadenceOfPath(path: string): number | undefined {
  const view = viewOfPath(path);
  return view?.layer === "lag" ? view.cadenceMs : undefined;
}

/** 推送连着时这份实时视图的轮询能否退成兜底（见 StatusView.pushCovers） */
export function pushCoversPath(path: string): boolean {
  return viewOfPath(path)?.pushCovers === true;
}

/** 是不是登记过的实时层视图（带查询串的切片按它的端点算）；推送重连时据此补取 */
export function isRealtimeViewPath(path: string): boolean {
  return viewOfPath(path)?.layer === "realtime";
}

/** 全部首屏缓存标签，不带 `page:` 前缀 */
export const STATUS_TAGS: readonly string[] = Object.freeze(
  entries().flatMap(([, view]) => (view.tag ? [view.tag] : [])),
);

// 可滞后层不推送：写入方直接写 KV，推来的新值会和几分钟旧的 KV 读数来回打架。
for (const [key, view] of entries()) {
  if (view.layer === "lag" && view.event) throw new Error(`status view "${key}" is lag-layer but has a push event`);
  if (view.layer === "realtime" && view.cadenceMs) throw new Error(`status view "${key}" is realtime but has a cadence`);
  if (view.pushCovers && !view.event) throw new Error(`status view "${key}" has pushCovers but no push event`);
}
