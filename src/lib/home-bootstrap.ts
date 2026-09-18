import { backendUrl } from "@/lib/backend-url";
import {
  ACTIVITY_PATH,
  CHARGER_PATH,
  CLOUDFLARE_WORKERS_PATH,
  DESKTOP_PATH,
  GITHUB_CHART_PATH,
  GITHUB_REPO_PATH,
  LISTENING_PATH,
  NOW_LISTENING_PATH,
  NOW_PLAYING_PATH,
  NOW_WATCHING_PATH,
  PLAYING_PATH,
  POWERBANK_PATH,
  PULSE_PATH,
  SERVER_PATH,
  TROPHIES_PATH,
  VERCEL_DEPLOYMENTS_PATH,
  VIBECODING_PATH,
  VIBECODING_YEAR_PATH,
  WATCHING_PATH,
} from "@/lib/paths";
import type { HomeSnapshot } from "@/lib/public-home";
import { hasLiveRead } from "@/lib/read-model-freshness";
import type { StatusResponse } from "@/lib/types";

/**
 * 浏览器挂载后的第一轮取数从 `/api/home` 一次取齐。
 *
 * 每张卡挂载时都要回源一次（服务端按当时时钟算的结论在 HTML 里放一会儿就不
 * 成立了），从前是十几个端点各打一枪。现在第一枪由这里统一打到聚合端点：
 * 它在 KV 里现成，一次请求带回全部信封；各卡之后的轮询仍走自己的端点和周期。
 *
 * 三条不能破的规矩：
 * - 页面收到过推送的路径不吃这份（见 lib/read-model-freshness），推来的永远最新；
 * - 聚合快照比首屏 HTML 用的那份还旧就整份作废，各卡照旧直接回源 ——
 *   Vercel 刚重建过首页时 KV 那份可能还没跟上，不能让挂载把新的盖成旧的；
 * - 只服务打开页面后头几秒内的第一次取数，之后挂载的卡片直接回源。
 */

export const HOME_PATH = "/api/home";
export const HOME_BOOTSTRAP_WINDOW_MS = 15_000;

/** 歌词和时区只在首屏 HTML 里用，没有自己的状态端点 */
type SnapshotKey = Exclude<keyof HomeSnapshot, "lyrics" | "timezone">;

/** 快照字段 ↔ 各卡的 SWR 键。新加快照字段而没配路径会在这里编译报错。 */
const SNAPSHOT_PATHS = {
  desktop: DESKTOP_PATH,
  activity: ACTIVITY_PATH,
  server: SERVER_PATH,
  charger: CHARGER_PATH,
  powerBank: POWERBANK_PATH,
  listening: LISTENING_PATH,
  nowListening: NOW_LISTENING_PATH,
  vibeCoding: VIBECODING_PATH,
  vibeCodingYear: VIBECODING_YEAR_PATH,
  watching: WATCHING_PATH,
  nowWatching: NOW_WATCHING_PATH,
  playing: PLAYING_PATH,
  playingNow: NOW_PLAYING_PATH,
  trophies: TROPHIES_PATH,
  githubChart: GITHUB_CHART_PATH,
  githubRepo: GITHUB_REPO_PATH,
  cloudflareWorkers: CLOUDFLARE_WORKERS_PATH,
  vercelDeployments: VERCEL_DEPLOYMENTS_PATH,
  pulse: PULSE_PATH,
} as const satisfies Record<SnapshotKey, string>;

const KEY_BY_PATH = new Map<string, SnapshotKey>(
  (Object.entries(SNAPSHOT_PATHS) as [SnapshotKey, string][]).map(([key, path]) => [path, key]),
);

type Aggregate = {
  /** KV 投影开始生成的时刻；回源时就是收到的时刻 */
  generatedAt: number;
  snapshot: Partial<Record<SnapshotKey, unknown>>;
};

export type HomeBootstrapDeps = {
  /** 拿到的是 `/api/home` 这个路径，由实现自己拼后端地址 */
  fetch: (path: string) => Promise<Response>;
  now: () => number;
  isLiveRead: (path: string) => boolean;
  windowMs?: number;
};

/**
 * 只有 `?since=` 可以吃聚合：增量拉取的合并器本来就得接受整份（游标早于
 * 服务端还留着的最旧点时服务端也回整份）。其他查询参数各有语义，不碰。
 */
function eligiblePath(url: string): string | null {
  const split = url.indexOf("?");
  const pathname = split < 0 ? url : url.slice(0, split);
  if (!KEY_BY_PATH.has(pathname)) return null;
  const query = new URLSearchParams(split < 0 ? "" : url.slice(split + 1));
  for (const key of query.keys()) if (key !== "since") return null;
  return pathname;
}

function isEnvelope(value: unknown): value is StatusResponse<unknown> {
  return typeof value === "object" && value != null && typeof (value as { ok?: unknown }).ok === "boolean";
}

export function createHomeBootstrap(deps: HomeBootstrapDeps) {
  const windowMs = deps.windowMs ?? HOME_BOOTSTRAP_WINDOW_MS;
  let startedAt: number | null = null;
  let aggregate: Promise<Aggregate | null> | null = null;
  let snapshotAt: number | null = null;
  const served = new Set<string>();

  async function load(): Promise<Aggregate | null> {
    try {
      const response = await deps.fetch(HOME_PATH);
      if (!response.ok) return null;
      const generatedAt = response.headers.get("X-Read-Model") === "kv"
        ? Date.parse(response.headers.get("X-Fetched-At") ?? "")
        : deps.now();
      if (!Number.isFinite(generatedAt)) return null;
      const snapshot = (await response.json()) as Aggregate["snapshot"];
      return { generatedAt, snapshot };
    } catch {
      return null;
    }
  }

  return {
    /** 首屏 HTML 用的快照是什么时候取的；比它旧的聚合快照不能用 */
    markSnapshotAt(at: number): void {
      snapshotAt = at;
    },
    /**
     * 该请求能不能由聚合快照代答。返回 null 表示直接回源；返回的 Promise 解析为
     * null 也是直接回源（聚合失败、太旧、字段缺失、中途收到了推送）。
     */
    slice<T>(url: string): Promise<StatusResponse<T> | null> | null {
      const path = eligiblePath(url);
      if (!path || deps.isLiveRead(path) || served.has(path)) return null;
      const now = deps.now();
      if (startedAt == null) {
        startedAt = now;
        aggregate = load();
      } else if (now - startedAt > windowMs) {
        return null;
      }
      served.add(path);
      const pending = aggregate as Promise<Aggregate | null>;
      return pending.then((result) => {
        if (!result || deps.isLiveRead(path)) return null;
        if (snapshotAt == null || result.generatedAt < snapshotAt) return null;
        const envelope = result.snapshot[KEY_BY_PATH.get(path) as SnapshotKey];
        return isEnvelope(envelope) ? (envelope as StatusResponse<T>) : null;
      });
    },
  };
}

export const homeBootstrap = createHomeBootstrap({
  fetch: (path) => fetch(backendUrl(path), { cache: "no-store" }),
  now: Date.now,
  isLiveRead: hasLiveRead,
});
