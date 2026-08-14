import { askRedis, key, tellRedis, withRedis } from "@/lib/redis";
import type { PowerBankSample, PowerBankStatus } from "@/lib/types";

/**
 * 充电宝状态与电量历史。
 *
 * 和充电头同一条来路：那台 Mac 把 BLE 解出来的遥测 POST 过来，这里落库。机制
 * 也照搬 lib/charger-store —— Redis 存最新快照加一条历史 list，Redis 不可达时
 * 退回进程内存。
 *
 * 存的曲线不一样：充电头画的是**总功率**，那东西每帧都在跳；充电宝画**电量**，
 * 它变得很慢（100W 快充下大约每秒 0.03%），所以采样间隔给得比充电头长得多，
 * 否则 400 个点只够覆盖十几分钟，看不出充放电的形状。
 */

const TTL_MS = 24 * 60 * 60 * 1000;
/** 曲线保留的采样点数，和充电头同一个量级 */
const HISTORY_LIMIT = 400;
/**
 * 两个采样点之间的最小间隔。
 *
 * 电量变化极慢，20 秒一个点已经足够画出形状，而 400 个点能覆盖两个多小时 ——
 * 这才是这条曲线该有的时间尺度。跟充电头一样，上报本身的节流窗口通常已经比
 * 这个大，这道闸真正拦的是插拔触发的即时上报。
 */
const MIN_SAMPLE_GAP_MS = 20_000;

const K_LATEST = key("powerbank", "latest");
const K_HISTORY = key("powerbank", "history");
const K_LAST_PUSH = key("powerbank", "lastPush");

const fallback = {
  latest: null as PowerBankStatus | null,
  receivedAt: 0,
  lastPushAt: 0,
  history: [] as PowerBankSample[],
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

async function readHistory(): Promise<PowerBankSample[]> {
  const answered = await askRedis((redis) => redis.lrange(K_HISTORY, 0, -1));
  if (!answered.reachable) return fallback.history;
  const parsed = (answered.value ?? []).flatMap((row) => {
    try {
      return [JSON.parse(row) as PowerBankSample];
    } catch {
      return [];
    }
  });
  if (parsed.length) fallback.history = parsed;
  return parsed.length ? parsed : fallback.persisted ? [] : fallback.history;
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
 * 记一条快照，返回「需要即时通知的内容变没变」。
 *
 * diff 必须服务端自己做：采集端 1 Hz 推流，每个上报周期都会带这个模块，收到就
 * 推的话推送会退化成定时广播。
 */
export async function recordStatus(status: PowerBankStatus, receivedAt = Date.now()) {
  const previous = await readLatest();
  const structuralChanged =
    !previous || structuralKey(previous.status) !== structuralKey(status);

  fallback.latest = status;
  fallback.receivedAt = receivedAt;
  fallback.lastPushAt = receivedAt;

  fallback.persisted = await tellRedis(async (redis) => {
    const pipe = redis.pipeline();
    pipe.set(K_LATEST, JSON.stringify({ status, receivedAt }), "PX", TTL_MS);
    pipe.set(K_LAST_PUSH, String(receivedAt), "PX", TTL_MS);
    return pipe.exec();
  });

  // 断开时不记点：那会在曲线上画出一条假的平线，看起来像电量一直没动。
  if (!status.connected || status.battery == null) return structuralChanged;

  const history = await readHistory();
  const last = history[history.length - 1];
  const at = status.updatedAt ?? receivedAt;
  let reset = false;

  if (last) {
    // 顺序很重要：时间倒流时差值是负数，也会小于 MIN_SAMPLE_GAP_MS。
    // 先判倒流再判间隔，否则重置分支永远走不到。
    if (at < last.t) {
      reset = true;
    } else if (at - last.t < MIN_SAMPLE_GAP_MS) {
      return structuralChanged;
    }
  }

  const sample: PowerBankSample = { t: at, p: status.battery };

  if (reset) fallback.history.length = 0;
  fallback.history.push(sample);
  if (fallback.history.length > HISTORY_LIMIT) {
    fallback.history.splice(0, fallback.history.length - HISTORY_LIMIT);
  }

  await withRedis(async (redis) => {
    const pipe = redis.pipeline();
    if (reset) pipe.del(K_HISTORY);
    pipe.rpush(K_HISTORY, JSON.stringify(sample));
    pipe.ltrim(K_HISTORY, -HISTORY_LIMIT, -1);
    pipe.pexpire(K_HISTORY, TTL_MS);
    await pipe.exec();
    return null;
  }, null);

  return structuralChanged;
}

export async function getStored() {
  const latest = await readLatest();
  if (!latest) return null;
  return { status: latest.status, receivedAt: latest.receivedAt, history: await readHistory() };
}

/** 最近一次推送的到达时刻，0 表示从没收到过 */
export async function lastPushReceivedAt() {
  const raw = await withRedis(async (redis) => redis.get(K_LAST_PUSH), null);
  const fromRedis = raw ? Number(raw) : 0;
  return Math.max(fromRedis || 0, fallback.lastPushAt);
}
