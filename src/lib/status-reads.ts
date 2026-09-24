import type { AgentStatusPayload } from "@/lib/agent-status-types";
import { backendUrl } from "@/lib/backend-url";
import { STATUS_VIEWS, bootstrapServes, viewKeyByPath } from "@/lib/status-views";
import type {
  DesktopPayload,
  ListeningPayload,
  NowListeningPayload,
  PowerBankPayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";

/**
 * 浏览器侧读一份状态信封。剩下两条规矩：有单调时间戳的 payload 按代数挡旧值；
 * 收过推送或失效通知的路径不再吃挂载引导那份聚合。KV 投影只服务慢端点，那些
 * 路径没有推送，曾经靠 `fresh=1` 绕过 KV 的整套机制已删。
 */

const live = new Set<string>();

/** 失效通知没有 payload，只标「刚变了」，让随后的重取不要再吃打开页面时那份聚合。 */
export function markLiveRead(path: string): void {
  live.add(path);
}

export function hasLiveRead(path: string): boolean {
  return live.has(path);
}

/**
 * 充电头不在这张表里：曲线由自己的增量累加器接，不能整份替换。
 * Emby / PlayStation 列表没有可比时刻，乱序靠 live 标记挡聚合，不在这里比大小。
 */
const STAMPS: Record<string, (data: never) => number | null> = {
  [STATUS_VIEWS.desktop.path]: (data: DesktopPayload) => data.receivedAt,
  [STATUS_VIEWS.listening.path]: (data: ListeningPayload) => data.fetchedAt,
  [STATUS_VIEWS.nowListening.path]: (data: NowListeningPayload) => data.receivedAt,
  [STATUS_VIEWS.powerBank.path]: (data: PowerBankPayload) => data.pushedAt,
  [STATUS_VIEWS.agentStatus.path]: (data: AgentStatusPayload) => data.fetchedAt,
  // 只在内容真变了才落库，所以存着的 observedAt 就是那一代的时刻
  [STATUS_VIEWS.trophies.path]: (data: TrophiesSummaryPayload) => data.observedAt,
};

function stampOf(path: string, envelope: StatusResponse<unknown>): number | null {
  if (!envelope.ok) return null;
  return STAMPS[path]?.(envelope.data as never) ?? null;
}

const latest = new Map<string, { stamp: number; envelope: StatusResponse<unknown> }>();

/** 挡乱序推送并登记 live。没有时间戳的推送照样登记，避免随后那份聚合把推来的盖回去。 */
export function acceptPush(path: string, envelope: StatusResponse<unknown>): boolean {
  const stamp = stampOf(path, envelope);
  const known = latest.get(path);
  if (stamp != null && known && known.stamp > stamp) return false;
  markLiveRead(path);
  if (stamp == null) return true;
  latest.set(path, { stamp, envelope });
  return true;
}

/**
 * 相等时以取回来的为准：同一代数据的存活结论会随时间和上下线而改变。
 * 错误必须可见，不以旧成功遮盖；live 标记不能随错误清掉，否则挂载引导会把推来的盖回去。
 */
export function guardPolled<T>(path: string, envelope: StatusResponse<T>): StatusResponse<T> {
  const stamp = stampOf(path, envelope);
  if (stamp == null) {
    latest.delete(path);
    return envelope;
  }
  const known = latest.get(path);
  if (known && known.stamp > stamp) return known.envelope as StatusResponse<T>;
  latest.set(path, { stamp, envelope });
  return envelope;
}

export const HOME_PATH = "/api/home";
export const HOME_BOOTSTRAP_WINDOW_MS = 15_000;
/** 十几张卡的第一次取数都等这一个请求，挂住就全挂住；超时后各卡自己回源 */
export const HOME_BOOTSTRAP_TIMEOUT_MS = 5_000;

/**
 * 只有 `?since=` 可以吃聚合：增量拉取的合并器本来就得接受整份（游标早于
 * 服务端还留着的最旧点时服务端也回整份）。其他查询参数各有语义，不碰。
 */
function eligiblePath(url: string): string | null {
  const split = url.indexOf("?");
  const pathname = split < 0 ? url : url.slice(0, split);
  if (!bootstrapServes(pathname)) return null;
  const query = new URLSearchParams(split < 0 ? "" : url.slice(split + 1));
  for (const key of query.keys()) if (key !== "since") return null;
  return pathname;
}

function isEnvelope(value: unknown): value is StatusResponse<unknown> {
  return typeof value === "object" && value != null && typeof (value as { ok?: unknown }).ok === "boolean";
}

export type HomeBootstrapDeps = {
  /** 拿到的是 `/api/home` 这个路径，由实现自己拼后端地址 */
  fetch: (path: string) => Promise<Response>;
  now: () => number;
  isLiveRead: (path: string) => boolean;
  windowMs?: number;
};

/**
 * 打开页面后头几秒内各卡第一次取数由一次 `/api/home` 代答。
 * `/api/home` 不进 KV、直读 DO，这份永远是此刻的；首屏 HTML 里按当时时钟算的结论
 * 放一会儿就不成立，所以挂载这一枪本来就要回源，从前是十几个端点各打一枪。
 */
export function createHomeBootstrap(deps: HomeBootstrapDeps) {
  const windowMs = deps.windowMs ?? HOME_BOOTSTRAP_WINDOW_MS;
  let startedAt: number | null = null;
  let aggregate: Promise<Record<string, unknown> | null> | null = null;
  const served = new Set<string>();

  async function load(): Promise<Record<string, unknown> | null> {
    try {
      const response = await deps.fetch(HOME_PATH);
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return {
    /**
     * 该请求能不能由聚合快照代答。返回 null 表示直接回源；返回的 Promise 解析为
     * null 也是直接回源（聚合失败、字段缺失或失败、中途收到了推送）。
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
      const pending = aggregate as Promise<Record<string, unknown> | null>;
      return pending.then((result) => {
        if (!result || deps.isLiveRead(path)) return null;
        const key = viewKeyByPath(path);
        const envelope = key ? result[key] : undefined;
        // 投影里那张卡当时就失败的话回源：挂载这一次本来就是给失败的首屏兜底的
        return isEnvelope(envelope) && envelope.ok ? (envelope as StatusResponse<T>) : null;
      });
    },
  };
}

const homeBootstrap = createHomeBootstrap({
  fetch: (path) => fetch(backendUrl(path), { cache: "no-store", signal: AbortSignal.timeout(HOME_BOOTSTRAP_TIMEOUT_MS) }),
  now: Date.now,
  isLiveRead: hasLiveRead,
});

export async function fetchStatus<T>(path: string): Promise<StatusResponse<T>> {
  const seeded = homeBootstrap.slice<T>(path);
  if (seeded) {
    const envelope = await seeded;
    if (envelope) return envelope;
  }
  const response = await fetch(backendUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`Request ${path} failed: ${response.status}`);
  return response.json();
}
