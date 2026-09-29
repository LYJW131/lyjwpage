import { AwaitingReport } from "@/lib/awaiting-report";
import { CHARGER_STALE_MS, heartbeatWindowMs } from "@/lib/freshness";
import { getStored, lastPushReceivedAt } from "@/lib/powerbank-store";
import { readLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import type { PowerBankPayload, PowerBankStatus } from "@/lib/types";

/**
 * Anker Prime 充电宝（A110G）遥测。
 *
 * 和充电头同一条来路：Mac 上报器把 BLE 解出来的数据放进 `chargingDevices`
 * 列表，本站按 `kind` 挑。本机浏览时打开 `/local/charging` 才会直连
 * `http://127.0.0.1:8787/sse/powerbank`，见 lib/local-charging。
 */

/**
 * 充电宝这一路多久没续上就算断流：默认 `CHARGER_STALE_MS`；上报间隔
 * （`CHARGER_PUSH_INTERVAL_MS`）配得更长时按 3 倍加长，不能短于默认。
 *
 * **也不能短于心跳窗口**，和 lib/anker 的 chargerStaleAfterMs 同一条理由：安静时段
 * 没有新读数可发，窗口比心跳间隔短的话，心跳但凡晚一点点就越界，卡片会闪回「未连接」。
 *
 * ⚠️ 这一半只是止血。充电宝**没有**和充电头 prepareHeartbeat 对称的续期路径：
 * `powerbank:lastPush` 只在 chargingDevices 里真带了 `kind:"powerBank"` 那一项时
 * 才被写（见 workers/api/src/stores/powerbank-store 的 prepareStatus），activeModules
 * 里也没有它。也就是说 BLE 短暂丢了、只开充电头模块的那些时段，续的人一个都没有。
 * 补一条充电宝心跳、还是明确决定「就按这个窗口判断断流」，是另一件事。
 *
 * 和充电头一样，源站只给原样的 connected 和时刻，断流由浏览器判
 * （lib/freshness 的 liveChargingFeed）。
 */
export function powerBankStaleAfterMs() {
  const interval = Number(process.env.CHARGER_PUSH_INTERVAL_MS) || 30_000;
  return Math.max(CHARGER_STALE_MS, interval * 3, heartbeatWindowMs());
}

/**
 * 推给浏览器的那一份，全部拿手上现成的东西拼，不读存储。
 *
 * 和充电头的 chargerPushPayload 同一个理由：读的话既白等一个来回，又逼得推送只能
 * 排在写库后面。状态是刚收到的，pushedAt 就是收到的时刻，存活也是刚算出来的。
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
  return withPresence(
    { ...status, pushedAt: receivedAt, staleAfterMs: powerBankStaleAfterMs() },
    liveness,
  );
}

export async function getPowerBankSnapshot(): Promise<PowerBankPayload> {
  const stored = await getStored();
  // 还没收到过任何推送。交给 statusEnvelope 变成降级信封，前端显示提示
  if (!stored) throw new AwaitingReport("尚未收到充电宝遥测推送");

  const [pushedAt, live] = await Promise.all([lastPushReceivedAt(), readLiveness()]);

  return withPresence({ ...stored.status, pushedAt, staleAfterMs: powerBankStaleAfterMs() }, live);
}
