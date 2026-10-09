// 此登记表同时被浏览器与 Worker 引用，不能引入服务端取数依赖。

export type StatusLayer = "realtime" | "lag";

export type StatusView = {
  path: `/api/status/${string}`;
  layer: StatusLayer;
  tag?: string;
  event?: string;
  cadenceMs?: number;
  pushCovers?: true;
};

export const STATUS_VIEWS = {
  desktop: { path: "/api/status/desktop", layer: "realtime", tag: "desktop", event: "desktop" },
  timezone: { path: "/api/status/timezone", layer: "lag", tag: "timezone" },
  workouts: { path: "/api/status/workouts", layer: "lag", tag: "workouts", cadenceMs: 3_600_000 },
  activity: { path: "/api/status/activity", layer: "lag", tag: "activity", cadenceMs: 3_600_000 },
  server: { path: "/api/status/server", layer: "lag", tag: "server", cadenceMs: 60_000 },
  charger: { path: "/api/status/charger", layer: "realtime", tag: "charger", event: "charger" },
  powerBank: { path: "/api/status/powerbank", layer: "realtime", tag: "powerbank", event: "powerbank" },
  listening: { path: "/api/status/listening", layer: "realtime", tag: "listening", event: "listening", pushCovers: true },
  nowListening: { path: "/api/status/listening/now", layer: "realtime", tag: "listening-now", event: "listening-now" },
  coding: { path: "/api/status/coding", layer: "realtime", tag: "coding" },
  codingNow: { path: "/api/status/coding/now", layer: "realtime", tag: "coding-now", event: "coding-now" },
  limits: { path: "/api/status/limits", layer: "lag", tag: "limits", cadenceMs: 5 * 60_000 },
  agentStatus: { path: "/api/status/agent-status", layer: "lag", tag: "agent-status", cadenceMs: 60_000 },
  codingYear: { path: "/api/status/coding/year", layer: "realtime", tag: "coding-year" },
  watching: { path: "/api/status/watching", layer: "realtime", tag: "watching", event: "watching", pushCovers: true },
  nowWatching: { path: "/api/status/watching/now", layer: "realtime", tag: "watching-now", event: "watching-now", pushCovers: true },
  playing: { path: "/api/status/playing", layer: "realtime", tag: "playing", event: "playing", pushCovers: true },
  playingNow: { path: "/api/status/playing/now", layer: "realtime", tag: "playing-now", event: "playing-now", pushCovers: true },
  questNow: { path: "/api/status/quest/now", layer: "realtime", tag: "quest-now", event: "quest-now" },
  trophies: { path: "/api/status/trophies", layer: "realtime", tag: "trophies", event: "trophies", pushCovers: true },
  githubChart: { path: "/api/status/github-chart", layer: "lag", cadenceMs: 10 * 60_000 },
  githubRepo: { path: "/api/status/github-repo", layer: "lag", cadenceMs: 30 * 60_000 },
  cloudflareWorkers: { path: "/api/status/cloudflare-workers", layer: "lag", cadenceMs: 2 * 60_000 },
  vercelDeployments: { path: "/api/status/vercel-deployments", layer: "lag", cadenceMs: 60_000 },
  sentry: { path: "/api/status/sentry", layer: "lag", cadenceMs: 5 * 60_000 },
  reporters: { path: "/api/status/reporters", layer: "lag", cadenceMs: 60_000 },
  pulse: { path: "/api/status/pulse", layer: "realtime" },
} as const satisfies Record<string, StatusView>;

export type StatusViewKey = keyof typeof STATUS_VIEWS;
export type EndpointViewKey = StatusViewKey;
export type StatusPath = (typeof STATUS_VIEWS)[StatusViewKey]["path"];

export const STATUS_VIEW_KEYS = Object.keys(STATUS_VIEWS) as StatusViewKey[];

function entries(): [StatusViewKey, StatusView][] {
  return Object.entries(STATUS_VIEWS) as [StatusViewKey, StatusView][];
}

export function endpointViews(): [StatusViewKey, StatusView][] {
  return entries();
}

const KEY_BY_PATH = new Map<string, EndpointViewKey>(endpointViews().map(([key, view]) => [view.path, key]));
export function viewKeyByPath(path: string): EndpointViewKey | undefined {
  return KEY_BY_PATH.get(path);
}

export function layerOfPath(path: string): StatusLayer {
  const key = viewKeyByPath(path);
  return key ? (STATUS_VIEWS[key] as StatusView).layer : "realtime";
}

const PATH_BY_EVENT = new Map<string, string>(
  entries().flatMap(([, view]) => (view.event && view.path ? [[view.event, view.path]] : [])),
);
export function pathByEvent(event: string): string | undefined {
  return PATH_BY_EVENT.get(event);
}

function viewOfPath(path: string): StatusView | undefined {
  const key = viewKeyByPath(path.split("?")[0]);
  return key ? (STATUS_VIEWS[key] as StatusView) : undefined;
}

export function cadenceOfPath(path: string): number | undefined {
  const view = viewOfPath(path);
  return view?.layer === "lag" ? view.cadenceMs : undefined;
}

export function pushCoversPath(path: string): boolean {
  return viewOfPath(path)?.pushCovers === true;
}

export function isPushedViewPath(path: string): boolean {
  return viewOfPath(path)?.event !== undefined;
}

export const STATUS_TAGS: readonly string[] = Object.freeze(
  entries().flatMap(([, view]) => (view.tag ? [view.tag] : [])),
);

// 可滞后层不推送：写入方直接写 KV，推来的新值会和几分钟旧的 KV 读数来回打架。
for (const [key, view] of entries()) {
  if (view.layer === "lag" && view.event) throw new Error(`status view "${key}" is lag-layer but has a push event`);
  if (view.layer === "realtime" && view.cadenceMs) throw new Error(`status view "${key}" is realtime but has a cadence`);
  if (view.pushCovers && !view.event) throw new Error(`status view "${key}" has pushCovers but no push event`);
}
