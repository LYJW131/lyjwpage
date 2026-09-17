import { DESKTOP_PATH, LISTENING_PATH, NOW_LISTENING_PATH, POWERBANK_PATH } from "@/lib/paths";
import { markLiveRead } from "@/lib/read-model-freshness";
import type {
  DesktopPayload,
  ListeningPayload,
  NowListeningPayload,
  PowerBankPayload,
  StatusResponse,
} from "@/lib/types";

/**
 * 推送和轮询写同一个 SWR 键，但后到的不一定更新。
 * 有单调时刻的 payload 按代数挡旧值；收到推送后，该路径的后续请求还会
 * 通过 backendUrl 加 fresh=1 绕过 KV，覆盖没有可比时间戳的 Emby / PS 列表。
 * SWR 键仍是原 path，只有实际请求 URL 变化；在途轮询与 mutate 的竞争仍交给 SWR。
 */
const STAMPS: Record<string, (data: never) => number | null> = {
  [DESKTOP_PATH]: (data: DesktopPayload) => data.receivedAt,
  [LISTENING_PATH]: (data: ListeningPayload) => data.fetchedAt,
  [NOW_LISTENING_PATH]: (data: NowListeningPayload) => data.receivedAt,
  [POWERBANK_PATH]: (data: PowerBankPayload) => data.pushedAt,
};

function stampOf(path: string, envelope: StatusResponse<unknown>): number | null {
  if (!envelope.ok) return null;
  return STAMPS[path]?.(envelope.data as never) ?? null;
}

const latest = new Map<string, { stamp: number; envelope: StatusResponse<unknown> }>();

/** 先挡乱序推送，再登记该路径；没有时间戳的推送也必须绕过 KV 旧投影。 */
export function rememberPushed(path: string, envelope: StatusResponse<unknown>): boolean {
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
 * 充电头仍由自己的增量累加器处理，不在这里整份替换功率曲线。
 */
export function freshest<T>(path: string, envelope: StatusResponse<T>): StatusResponse<T> {
  const stamp = stampOf(path, envelope);
  if (stamp == null) {
    // 错误必须可见，不以旧成功遮盖；但该页面的 fresh=1 标记不能随错误清掉。
    latest.delete(path);
    return envelope;
  }
  const known = latest.get(path);
  if (known && known.stamp > stamp) return known.envelope as StatusResponse<T>;
  latest.set(path, { stamp, envelope });
  return envelope;
}
