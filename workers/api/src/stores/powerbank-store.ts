import { tellStorage } from "@/lib/storage";
import { recordStateChange } from "@api/stores/state-journal";
import { powerBankState } from "@shared/state-journal";
import type { PowerBankStatus } from "@/lib/types";
import { fallback, K_LAST_PUSH, K_LATEST, type Stored } from "@shared/powerbank-store";

/**
 * 充电宝最新状态。
 *
 * 和充电头同一条来路：那台 Mac 把 BLE 解出来的遥测 POST 过来，这里落库。机制
 * 照搬 lib/charger-store —— SQLite 存最新快照，SQLite 不可达时退回进程内存。
 *
 * **不存功率曲线。** 电量以小时为尺度变化，卡片上没画曲线。插拔、充放电、
 * 整数电量这些展示状态的变化进状态存档，不在这里留采样点。
 */

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 「需要即时通知」的指纹。
 *
 * 电量、功率、温度都在缓慢滚动，进指纹就等于把即时推送打成定时广播。这里只收
 * 会跳变的东西：连断、插拔、每个口的方向、充放电切换、热控翻转，以及整数电量
 * ——最后这个是显示边界，卡片上就写着整数，跳一格该立刻更新。
 */
function structuralKey(status: PowerBankStatus) {
  return JSON.stringify([
    status.connected,
    status.charging,
    status.thermalLimited,
    status.battery == null ? null : Math.round(status.battery),
    status.device.serialNumber,
    status.device.firmwareVersion,
    status.ports.map((port) => [port.id, port.active, port.direction, port.attached]),
  ]);
}

/**
 * 收一条快照：读已经在外面做完了，这里只算，写留给 commit。
 *
 * `structuralChanged` 的 diff 必须服务端自己做：采集端 1 Hz 推流，每个上报周期
 * 都会带这个模块，收到就推的话推送会退化成定时广播。
 */
export function prepareStatus(
  status: PowerBankStatus,
  receivedAt: number,
  previous: Stored | null,
): { structuralChanged: boolean; commit: () => Promise<void> } {
  const structuralChanged =
    !previous || structuralKey(previous.status) !== structuralKey(status);

  return {
    structuralChanged,
    commit: async () => {
      fallback.persisted = await tellStorage(async (storage) => {
        const pipe = storage.batch();
        pipe.set(K_LATEST, JSON.stringify({ status, receivedAt }), { ttlMs: TTL_MS });
        pipe.set(K_LAST_PUSH, String(receivedAt), { ttlMs: TTL_MS });
        return pipe.execute();
      });
      fallback.latest = status;
      fallback.receivedAt = receivedAt;
      fallback.lastPushAt = receivedAt;
      if (fallback.persisted) await recordStateChange("powerbank", receivedAt, powerBankState(status));
    },
  };
}
