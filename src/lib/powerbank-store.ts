import { askRedis, key, tellRedis, withRedis } from "@/lib/redis";
import type { PowerBankStatus } from "@/lib/types";

/**
 * 充电宝最新状态。
 *
 * 和充电头同一条来路：那台 Mac 把 BLE 解出来的遥测 POST 过来，这里落库。机制
 * 照搬 lib/charger-store —— Redis 存最新快照，Redis 不可达时退回进程内存。
 *
 * **不存历史。** 充电头那条功率曲线值得存，因为功率每帧都在跳、形状有信息；
 * 电量以小时为尺度变化，画出来几乎是条水平线，卡片上也就没画。既然没人消费，
 * 采样间隔、裁剪、TTL 那一整套就都不该存在。
 */

const TTL_MS = 24 * 60 * 60 * 1000;

const K_LATEST = key("powerbank", "latest");
const K_LAST_PUSH = key("powerbank", "lastPush");

const fallback = {
  latest: null as PowerBankStatus | null,
  receivedAt: 0,
  lastPushAt: 0,
  persisted: false,
};

type Stored = { status: PowerBankStatus; receivedAt: number };

function fromMemory(): Stored | null {
  return fallback.latest
    ? { status: fallback.latest, receivedAt: fallback.receivedAt }
    : null;
}

async function readLatest(): Promise<Stored | null> {
  const answered = await askRedis((redis) => redis.get(K_LATEST));
  // Redis 答不上话，只能信内存
  if (!answered.reachable) return fromMemory();

  if (answered.value) {
    let stored: Stored;
    try {
      stored = JSON.parse(answered.value) as Stored;
    } catch {
      // 脏数据按「答不上来」算，不按「没有」—— 否则会连累好好的内存副本
      return fromMemory();
    }
    // 写失败过时内存这份更新，别被 Redis 里故障前的旧值盖回去
    if (!fallback.persisted && fallback.latest && fallback.receivedAt > stored.receivedAt) {
      return fromMemory();
    }
    fallback.latest = stored.status;
    fallback.receivedAt = stored.receivedAt;
    fallback.persisted = true;
    return stored;
  }

  // Redis 明确说没有：内存那份没落库过才还算数，落过库说明是真被清了
  return fallback.persisted ? null : fromMemory();
}

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
 * 上一份快照。和充电头那边的 readChargerState 同一个用法：调用方在信封解析完
 * 就发车，和这封的其它读重叠，到充电宝分支再接住。
 */
export function readPowerBankState(): Promise<Stored | null> {
  return readLatest();
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
      fallback.latest = status;
      fallback.receivedAt = receivedAt;
      fallback.lastPushAt = receivedAt;

      fallback.persisted = await tellRedis(async (redis) => {
        const pipe = redis.pipeline();
        pipe.set(K_LATEST, JSON.stringify({ status, receivedAt }), "PX", TTL_MS);
        pipe.set(K_LAST_PUSH, String(receivedAt), "PX", TTL_MS);
        return pipe.exec();
      });
    },
  };
}

export async function getStored() {
  const latest = await readLatest();
  return latest ? { status: latest.status, receivedAt: latest.receivedAt } : null;
}

/** 最近一次推送的到达时刻，0 表示从没收到过 */
export async function lastPushReceivedAt() {
  const raw = await withRedis(async (redis) => redis.get(K_LAST_PUSH), null);
  const fromRedis = raw ? Number(raw) : 0;
  return Math.max(fromRedis || 0, fallback.lastPushAt);
}
