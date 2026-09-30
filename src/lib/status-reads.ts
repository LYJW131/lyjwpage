import { backendUrl } from "@/lib/backend-url";
import { STATUS_VIEWS } from "@/lib/status-views";
import type { QuestNow } from "@shared/quest";
import type {
  DesktopPayload,
  ListeningPayload,
  NowListeningPayload,
  PowerBankPayload,
  StatusResponse,
  TrophiesSummaryPayload,
} from "@/lib/types";


const STAMPS: Record<string, (data: never) => number | null> = {
  [STATUS_VIEWS.questNow.path]: (data: QuestNow) => data.observedAt,
  [STATUS_VIEWS.desktop.path]: (data: DesktopPayload) => data.receivedAt,
  [STATUS_VIEWS.listening.path]: (data: ListeningPayload) => data.fetchedAt,
  [STATUS_VIEWS.nowListening.path]: (data: NowListeningPayload) => data.receivedAt,
  [STATUS_VIEWS.powerBank.path]: (data: PowerBankPayload) => data.pushedAt,
  [STATUS_VIEWS.trophies.path]: (data: TrophiesSummaryPayload) => data.observedAt,
};

function stampOf(path: string, envelope: StatusResponse<unknown>): number | null {
  if (!envelope.ok) return null;
  return STAMPS[path]?.(envelope.data as never) ?? null;
}

const latest = new Map<string, { stamp: number; envelope: StatusResponse<unknown> }>();

// 所有缓存写入必须推进代次，否则慢轮询可能覆盖期间已处理的新响应。
const generations = new Map<string, number>();

export function writeGeneration(path: string): number {
  return generations.get(path) ?? 0;
}

function advance(path: string): void {
  generations.set(path, writeGeneration(path) + 1);
}

export function acceptPush(path: string, envelope: StatusResponse<unknown>): boolean {
  const stamp = stampOf(path, envelope);
  const known = latest.get(path);
  if (stamp != null && known && known.stamp > stamp) return false;
  advance(path);
  if (stamp != null) latest.set(path, { stamp, envelope });
  return true;
}

export function guardPolled<T>(path: string, envelope: StatusResponse<T>): StatusResponse<T> {
  advance(path);
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

// servedAt 每次响应都会变化，必须在 SWR 深比较前剥离，避免无效重渲染。
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
