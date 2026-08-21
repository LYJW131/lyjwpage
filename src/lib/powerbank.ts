import { getStored, lastPushReceivedAt } from "@/lib/powerbank-store";
import {
  offlineByLiveness,
  readLiveness,
  withPresence,
  type Liveness,
} from "@/lib/reporter-liveness";
import type { PowerBankPayload, PowerBankStatus } from "@/lib/types";

export {
  POWER_BANK_MAX_OUTPUT,
  type RawPowerBank,
  normalizePowerBank,
  pickPowerBank,
} from "@/lib/charging-device";

/**
 * Anker Prime 充电宝（A110G）遥测。
 *
 * 和充电头同一条来路：Mac 上报器把 BLE 解出来的数据放进 `chargingDevices`
 * 列表，本站按 `kind` 挑。本机浏览时还可以直连
 * `http://127.0.0.1:8787/sse/powerbank`，见 lib/local-charging。
 */

/** 默认 90 秒；上报间隔配得更长时按 3 倍加长，不能短于默认。 */
export function powerBankStaleAfterMs() {
  const interval = Number(process.env.CHARGER_PUSH_INTERVAL_MS) || 30_000;
  return Math.max(90_000, interval * 3);
}

/**
 * 和充电头同一套收卡口径：上报器离线，或者太久没推，就把 connected 打成 false。
 * 卡片只看这个字段，不在浏览器再算一遍过期。
 */
export function withPowerBankFreshness(
  payload: PowerBankPayload,
  now = Date.now(),
): PowerBankPayload {
  const stale =
    offlineByLiveness(payload) || now - payload.pushedAt > payload.staleAfterMs;
  return { ...payload, connected: stale ? false : payload.connected };
}

/**
 * 推给浏览器的那一份，全部拿手上现成的东西拼，一次 Redis 都不读。
 *
 * 和充电头的 chargerPushPayload 同一个理由：从前这里是 getPowerBankSnapshot()，
 * 它读的正是这次上报刚写下去的那个键 —— 既白等一个来回，又逼得推送只能排在
 * 写库后面。状态是刚收到的，pushedAt 就是收到的时刻，存活也是刚算出来的。
 */
export function powerBankPushPayload({
  status,
  receivedAt,
  liveness,
}: {
  status: PowerBankStatus;
  receivedAt: number;
  liveness: Liveness;
}): PowerBankPayload {
  return withPowerBankFreshness(
    withPresence(
      { ...status, pushedAt: receivedAt, staleAfterMs: powerBankStaleAfterMs() },
      liveness,
    ) as PowerBankPayload,
  );
}

export async function getPowerBankSnapshot(): Promise<PowerBankPayload> {
  const stored = await getStored();
  // 还没收到过任何推送。交给 statusRoute 变成降级信封，前端显示提示
  if (!stored) throw new Error("尚未收到充电宝遥测推送");

  const [pushedAt, live] = await Promise.all([lastPushReceivedAt(), readLiveness()]);

  return withPresence(
    { ...stored.status, pushedAt, staleAfterMs: powerBankStaleAfterMs() } as PowerBankPayload,
    live,
  );
}
