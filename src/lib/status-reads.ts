import { backendUrl } from "@/lib/backend-url";
import { STATUS_VIEWS } from "@/lib/status-views";
import type {
  DesktopPayload,
  ListeningPayload,
  NowListeningPayload,
  PowerBankPayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";

/**
 * 浏览器侧读一份状态信封。唯一的规矩：有单调时间戳的 payload 按代数挡旧值，
 * 慢了一步的轮询不能把刚推来的新值盖回去。首屏按卡读取之后没有聚合端点，
 * 挂载时各卡直连自己的端点（可滞后卡首屏够新就不回源，见 hooks/use-status）。
 */

/**
 * 充电头不在这张表里：曲线由自己的增量累加器接，不能整份替换。
 * Emby / PlayStation 列表没有可比时刻，不在这里比大小。
 */
const STAMPS: Record<string, (data: never) => number | null> = {
  [STATUS_VIEWS.desktop.path]: (data: DesktopPayload) => data.receivedAt,
  [STATUS_VIEWS.listening.path]: (data: ListeningPayload) => data.fetchedAt,
  [STATUS_VIEWS.nowListening.path]: (data: NowListeningPayload) => data.receivedAt,
  [STATUS_VIEWS.powerBank.path]: (data: PowerBankPayload) => data.pushedAt,
  // 只在内容真变了才落库，所以存着的 observedAt 就是那一代的时刻
  [STATUS_VIEWS.trophies.path]: (data: TrophiesSummaryPayload) => data.observedAt,
};

function stampOf(path: string, envelope: StatusResponse<unknown>): number | null {
  if (!envelope.ok) return null;
  return STAMPS[path]?.(envelope.data as never) ?? null;
}

const latest = new Map<string, { stamp: number; envelope: StatusResponse<unknown> }>();

/** 挡乱序推送：比手上那一代还旧的推送丢掉 */
export function acceptPush(path: string, envelope: StatusResponse<unknown>): boolean {
  const stamp = stampOf(path, envelope);
  const known = latest.get(path);
  if (stamp != null && known && known.stamp > stamp) return false;
  if (stamp == null) return true;
  latest.set(path, { stamp, envelope });
  return true;
}

/**
 * 相等时以取回来的为准：同一代数据的存活结论会随时间和上下线而改变。
 * 错误必须可见，不以旧成功遮盖。
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

/**
 * 摘掉信封上的 servedAt。它每次响应都不一样，留着的话 SWR 的深比较永远判「变了」，
 * 数据一个字节没动也会让整张卡每轮轮询重渲染一遍（见 lib/types 的 StatusResponse）。
 * 浏览器只在首帧用它（首屏那份 fallback 不经过这里），挂载后有自己的钟。
 */
export function withoutServedAt<T>(envelope: StatusResponse<T>): StatusResponse<T> {
  if (!envelope.ok || envelope.servedAt === undefined) return envelope;
  const { ok, data, updatedAt } = envelope;
  return updatedAt === undefined ? { ok, data } : { ok, data, updatedAt };
}

export async function fetchStatus<T>(path: string): Promise<StatusResponse<T>> {
  const response = await fetch(backendUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`Request ${path} failed: ${response.status}`);
  return withoutServedAt<T>(await response.json());
}
