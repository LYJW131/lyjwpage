/**
 * 公开状态视图的唯一登记表。
 *
 * 一个视图 = 首页快照 `/api/home` 里的一个字段。它在两侧的所有名字都从这里派生：
 * 单端点路径（`/api/status/...`）、Vercel 缓存标签（`page:<tag>`）、WebSocket
 * 事件名、KV 读模型策略。以前这些名字分散在七八张手写表里，新加一张卡要改十个
 * 文件，而且表和表之间没有编译期约束。现在只加这里一行，其余各处按 key 取。
 *
 * 这个文件必须保持同构：浏览器（SWR 键、推送分发、挂载引导）和 Worker 都会 import，
 * 所以只放元数据，不放取数函数。服务端 loader 按同一组 key 登记在
 * `src/lib/status-loaders.ts`，两张表由 `satisfies Record<StatusViewKey, …>` 强制对齐。
 *
 * 命名规则（见 AGENTS.md「API 命名与跨端契约」）：`X` 是列表 / 历史，`X/now` 是此刻；
 * 事件名跟随路径、`/` 换成 `-`。`vibecoding-now` 是唯一的例外：它只推「此刻」那几个
 * 字段、并进 `/api/status/vibecoding` 整份里，没有独立端点。
 */

/** KV 公开读取投影策略。只剩慢端点一档：分钟级才变、没有推送、浏览器裸轮询。 */
export type ReadModelPolicy = "slow";

export type StatusView = {
  /** 单端点路径。没有的视图只活在 `/api/home` 里（timezone、lyrics）。 */
  path?: `/api/status/${string}`;
  /** Vercel 首屏缓存标签（不带 `page:` 前缀）。没有的视图变化不触发首屏重建。 */
  tag?: string;
  /**
   * 带数据的推送事件名。收到后直接写进该视图的 SWR 键。
   * 有事件的视图**不能**进 KV：推来的永远最新，投影最多几分钟旧，两者不能共存。
   * `readModelViews()` 下面的断言在模块加载时就把这条守住。
   */
  event?: string;
  /** 进 KV 投影。只有没有推送、没有「此刻」语义的慢端点才配。 */
  readModel?: ReadModelPolicy;
  /**
   * 首屏字段和无参端点形状不同（loader 表里有 `home()` 覆盖且类型不同）时置 false：
   * 浏览器挂载引导不能拿 `/api/home` 里这一格去代答该端点的请求。
   */
  bootstrap?: false;
};

export const STATUS_VIEWS = {
  desktop: { path: "/api/status/desktop", tag: "desktop", event: "desktop" },
  /** 只在首屏 HTML 里用，没有自己的端点 */
  timezone: { tag: "timezone" },
  workouts: { path: "/api/status/workouts", tag: "workouts" },
  activity: { path: "/api/status/activity", tag: "activity" },
  server: { path: "/api/status/server", tag: "server" },
  charger: { path: "/api/status/charger", tag: "charger", event: "charger" },
  powerBank: { path: "/api/status/powerbank", tag: "powerbank", event: "powerbank" },
  listening: { path: "/api/status/listening", tag: "listening", event: "listening" },
  nowListening: { path: "/api/status/listening/now", tag: "listening-now", event: "listening-now" },
  vibeCoding: { path: "/api/status/vibecoding", tag: "vibecoding", event: "vibecoding-now" },
  vibeCodingYear: { path: "/api/status/vibecoding/year", tag: "vibecoding-year", readModel: "slow" },
  watching: { path: "/api/status/watching", tag: "watching", event: "watching" },
  nowWatching: { path: "/api/status/watching/now", tag: "watching-now", event: "watching-now" },
  playing: { path: "/api/status/playing", tag: "playing", event: "playing" },
  playingNow: { path: "/api/status/playing/now", tag: "playing-now", event: "playing-now" },
  /**
   * 首屏字段是摘要（TrophiesSummaryPayload），单端点是整份目录 / 按 titleIds 切片
   * （TrophiesPayload）；浏览器从不裸读这条端点，只带 `?titleids=`，所以它不进 KV。
   */
  trophies: { path: "/api/status/trophies", tag: "trophies", bootstrap: false },
  githubChart: { path: "/api/status/github-chart", readModel: "slow" },
  githubRepo: { path: "/api/status/github-repo", readModel: "slow" },
  cloudflareWorkers: { path: "/api/status/cloudflare-workers", readModel: "slow" },
  vercelDeployments: { path: "/api/status/vercel-deployments", readModel: "slow" },
  pulse: { path: "/api/status/pulse", readModel: "slow" },
  /** 首屏歌词，按 nowListening 的 songId 现解，没有状态端点 */
  lyrics: {},
} as const satisfies Record<string, StatusView>;

export type StatusViewKey = keyof typeof STATUS_VIEWS;

type ViewsWithPath = { [K in StatusViewKey]: (typeof STATUS_VIEWS)[K] extends { path: string } ? K : never }[StatusViewKey];
/** 有单端点的视图 key */
export type EndpointViewKey = ViewsWithPath;
export type StatusPath = (typeof STATUS_VIEWS)[EndpointViewKey]["path"];

export const STATUS_VIEW_KEYS = Object.keys(STATUS_VIEWS) as StatusViewKey[];

function entries(): [StatusViewKey, StatusView][] {
  return Object.entries(STATUS_VIEWS) as [StatusViewKey, StatusView][];
}

/** 有单端点的视图，按登记顺序 */
export function endpointViews(): [EndpointViewKey, StatusView & { path: string }][] {
  return entries().filter((entry): entry is [EndpointViewKey, StatusView & { path: string }] => !!entry[1].path);
}

const KEY_BY_PATH = new Map<string, EndpointViewKey>(endpointViews().map(([key, view]) => [view.path, key]));
/** 路径 → 视图 key；不认识的路径（歌词、令牌、带前缀写错的）返回 undefined */
export function viewKeyByPath(path: string): EndpointViewKey | undefined {
  return KEY_BY_PATH.get(path);
}

/** 该端点的挂载引导能否由 `/api/home` 同名字段代答 */
export function bootstrapServes(path: string): boolean {
  const key = viewKeyByPath(path);
  return !!key && (STATUS_VIEWS[key] as StatusView).bootstrap !== false;
}

const PATH_BY_EVENT = new Map<string, string>(
  entries().flatMap(([, view]) => (view.event && view.path ? [[view.event, view.path]] : [])),
);
/** 事件名 → 该事件写入的端点路径（也就是 SWR 键）；`presence` 这种不带数据的事件没有 */
export function pathByEvent(event: string): string | undefined {
  return PATH_BY_EVENT.get(event);
}

/** 全部首屏缓存标签，不带 `page:` 前缀 */
export const STATUS_TAGS: readonly string[] = Object.freeze(
  entries().flatMap(([, view]) => (view.tag ? [view.tag] : [])),
);

/** 进 KV 投影的端点路径 */
export const READ_MODEL_PATHS: readonly string[] = Object.freeze(
  entries().flatMap(([, view]) => (view.readModel && view.path ? [view.path] : [])),
);

export function readModelPolicyOf(path: string): ReadModelPolicy | undefined {
  const key = viewKeyByPath(path);
  return key ? (STATUS_VIEWS[key] as StatusView).readModel : undefined;
}

// 推送与 KV 互斥：有事件的视图进了 KV，推来的新值会被几分钟旧的投影盖回去。
for (const [key, view] of entries()) {
  if (view.event && view.readModel) throw new Error(`status view "${key}" has both a push event and a read model`);
  if (view.readModel && !view.path) throw new Error(`status view "${key}" has a read model but no endpoint`);
}
