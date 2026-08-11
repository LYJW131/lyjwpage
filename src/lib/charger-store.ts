import { CHARGER_HISTORY_LIMIT } from "@/lib/limits";
import { askRedis, key, tellRedis, withRedis } from "@/lib/redis";
import type { ChargerSample, ChargerStatus } from "@/lib/types";

/**
 * 充电头状态与总功率历史。
 *
 * 数据是「推」进来的：那台机器周期性把 a2687 的 /status 原样 POST 过来。
 * 间隔以秒计，光靠客户端自己累积的话页面一刷新曲线就没了、还要攒很久
 * 才有形状 —— 所以历史必须存在服务端。
 *
 * 存 Redis：进程重启后历史还在。没配 Redis 就退回进程内存。
 */

/**
 * 两个采样点之间的最小间隔，用来控制曲线的时间跨度。
 *
 * 采集端本身是 1 Hz，但上报按上报器的节流窗口走（代码默认 10 秒，本机配的是
 * 30 秒），所以到这里的间隔由
 * 上报间隔决定、通常已经大于这个阈值 —— 它真正拦的是即时上报：插拔、播放
 * 变化会把充电器快照顺带捎出去，那些不该在曲线上挤成一团。
 * 要拉长曲线跨度就调大它，或者调 CHARGER_HISTORY_LIMIT。
 */
const MIN_SAMPLE_GAP_MS = 5_000;

/** 连续断联满半小时后，旧曲线不再属于下一次连接。 */
const DISCONNECTED_HISTORY_AFTER_MS = 30 * 60 * 1000;

/** 历史和快照的保留时长，比断流阈值宽松得多，重启后仍能接上 */
const TTL_MS = 24 * 60 * 60 * 1000;

const K_LATEST = key("charger", "latest");
const K_HISTORY = key("charger", "history");
const K_LAST_PUSH = key("charger", "lastPush");

/**
 * Redis 不可达时的退路。规则和 lib/redis 的 mirrorKey 一致，这里手写是因为
 * 充电头是两个 string 键加一条 list，套不进单键那个工厂。
 *
 * `persisted` 记的是内存这份有没有真落进 Redis：没落进去时它就是唯一真相，
 * Redis 说「没有」不能当成「被删了」。
 */
const fallback = {
  latest: null as ChargerStatus | null,
  receivedAt: 0,
  disconnectedAt: 0,
  lastPushAt: 0,
  history: [] as ChargerSample[],
  persisted: false,
};

type Stored = {
  status: ChargerStatus;
  receivedAt: number;
  /** 首次收到 connected=false 的时刻；旧数据没有这一列时退回 receivedAt。 */
  disconnectedAt?: number | null;
};

function fromMemory(): Stored | null {
  return fallback.latest
    ? {
        status: fallback.latest,
        receivedAt: fallback.receivedAt,
        disconnectedAt: fallback.disconnectedAt || null,
      }
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
    const disconnectedAt = stored.status.connected
      ? 0
      : stored.disconnectedAt ?? stored.receivedAt;
    fallback.latest = stored.status;
    fallback.receivedAt = stored.receivedAt;
    fallback.disconnectedAt = disconnectedAt;
    fallback.persisted = true;
    return { ...stored, disconnectedAt: disconnectedAt || null };
  }

  // Redis 说没有：写进去过就是真被删了
  if (fallback.persisted) {
    fallback.latest = null;
    fallback.receivedAt = 0;
    fallback.disconnectedAt = 0;
    fallback.history.length = 0;
    return null;
  }
  return fromMemory();
}

/**
 * 曲线不比时间戳，比 latest 那份就够 —— 两者同一次写入、同生共死。Redis 故障
 * 窗里漏掉几个功率点在图上看不出来，为它单独记一套新旧不值当。
 */
async function readHistory(): Promise<ChargerSample[]> {
  const answered = await askRedis((redis) => redis.lrange(K_HISTORY, 0, -1));
  if (!answered.reachable) return [...fallback.history];

  if (answered.value.length) {
    const parsed: ChargerSample[] = [];
    for (const item of answered.value) {
      try {
        parsed.push(JSON.parse(item) as ChargerSample);
      } catch {
        // 跳过坏点，不因为一条脏数据丢掉整条曲线
      }
    }
    fallback.history = [...parsed];
    return parsed;
  }

  if (fallback.persisted) {
    fallback.history.length = 0;
    return [];
  }
  return [...fallback.history];
}

async function clearHistory() {
  fallback.history.length = 0;
  await withRedis(async (redis) => redis.del(K_HISTORY), 0);
}

function disconnectedHistoryExpired(stored: Stored, now: number) {
  if (stored.status.connected) return false;
  const disconnectedAt = stored.disconnectedAt ?? stored.receivedAt;
  return now - disconnectedAt >= DISCONNECTED_HISTORY_AFTER_MS;
}

/**
 * 断联后即使状态不再变化，presence 心跳仍会走到这里；因此不依赖新的 charger
 * 快照，也能在断联满半小时后把服务端历史清空。
 */
async function clearExpiredDisconnectedHistory(now: number) {
  const latest = await readLatest();
  if (!latest || !disconnectedHistoryExpired(latest, now)) return false;
  const history = await readHistory();
  if (!history.length) return false;
  await clearHistory();
  return true;
}

/**
 * 「结构性」指纹：插拔、换设备、换充电器本身。
 *
 * `active` 来自充电头给的端口开关位，不是从功率推的 —— 插着线不取电的口是
 * 开 + 0.00W，所以它能认出「插上了但还没开始充」，比设备名灵：插一个采集端
 * 表里没有的设备，`device` 是 null，但开关位一定会翻。
 *
 * 不取 `power` / `voltage` / `current`：那三个充电时每帧都在动，进指纹就等于
 * 把即时推送打成定时推送，它们本来就该走卡片自己的轮询。
 */
function structuralKey(status: ChargerStatus) {
  return JSON.stringify([
    status.connected,
    status.device.serialNumber,
    status.device.firmwareVersion,
    status.ports.map((port) => [port.id, port.active, port.device]),
  ]);
}

/**
 * 记一条快照。同一个 updatedAt 重复推送不会产生重复采样点。
 *
 * 返回结构性内容变没变，调用方据此决定要不要推送。这个 diff 必须服务端
 * 自己做：充电时采集端每个上报周期都会带 charger 模块（功率两位小数必变），
 * 收到就推的话推送会退化成定时广播，「插拔即时」也就没了意义。
 */
export async function recordStatus(status: ChargerStatus, receivedAt = Date.now()) {
  const previous = await readLatest();
  const previousDisconnectedAt =
    previous && !previous.status.connected
      ? previous.disconnectedAt ?? previous.receivedAt
      : null;
  const disconnectedAt = status.connected
    ? 0
    : previousDisconnectedAt ?? receivedAt;
  const resetAfterDisconnect =
    previousDisconnectedAt != null &&
    receivedAt - previousDisconnectedAt >= DISCONNECTED_HISTORY_AFTER_MS;
  // 第一份快照也算变化：客户端手上还什么都没有，该收到一次
  const structuralChanged =
    !previous || structuralKey(previous.status) !== structuralKey(status);

  fallback.latest = status;
  fallback.receivedAt = receivedAt;
  fallback.disconnectedAt = disconnectedAt;
  fallback.lastPushAt = receivedAt;

  fallback.persisted = await tellRedis(async (redis) => {
    const pipe = redis.pipeline();
    pipe.set(
      K_LATEST,
      JSON.stringify({ status, receivedAt, disconnectedAt: disconnectedAt || null }),
      "PX",
      TTL_MS,
    );
    pipe.set(K_LAST_PUSH, String(receivedAt), "PX", TTL_MS);
    return pipe.exec();
  });

  let history = await readHistory();
  if (resetAfterDisconnect) {
    // 超时后持续断联的 0W 快照也不再入库；重连的这一帧则从空历史重新起步。
    if (history.length) await clearHistory();
    history = [];
    if (!status.connected) return structuralChanged;
  }

  // 同一帧被推两次时不重复记。采集端现在是 1 Hz 推流，每帧都会换 updated_at，
  // 所以这道判断只在重试或重复投递时才拦得住东西 —— 留着是因为那才是它的本意。
  if (
    previous &&
    status.updatedAt != null &&
    previous.status.updatedAt === status.updatedAt
  ) {
    return structuralChanged;
  }

  const last = history[history.length - 1];
  const at = status.updatedAt ?? receivedAt;
  let reset = false;

  if (last) {
    // 顺序很重要：时间倒流时 (at - last.t) 是负数，也会小于 MIN_SAMPLE_GAP_MS。
    // 先判倒流再判间隔，否则重置分支永远走不到，新数据会被一直丢掉。
    if (at < last.t) {
      // 对端改了时钟或换了数据源，旧历史已经没法和新的拼在一条时间轴上
      reset = true;
    } else if (at - last.t < MIN_SAMPLE_GAP_MS) {
      return structuralChanged;
    }
  }

  const sample: ChargerSample = { t: at, w: status.totalPower };

  if (reset) fallback.history.length = 0;
  fallback.history.push(sample);
  if (fallback.history.length > CHARGER_HISTORY_LIMIT) {
    fallback.history.splice(0, fallback.history.length - CHARGER_HISTORY_LIMIT);
  }

  await withRedis(async (redis) => {
    const pipe = redis.pipeline();
    if (reset) pipe.del(K_HISTORY);
    pipe.rpush(K_HISTORY, JSON.stringify(sample));
    // 只留最近 CHARGER_HISTORY_LIMIT 条，用 Redis 自己的裁剪，不用把整条读回来重写
    pipe.ltrim(K_HISTORY, -CHARGER_HISTORY_LIMIT, -1);
    pipe.pexpire(K_HISTORY, TTL_MS);
    await pipe.exec();
    return null;
  }, null);

  return structuralChanged;
}

export async function getStored() {
  const latest = await readLatest();
  if (!latest) return null;
  let history = await readHistory();
  if (disconnectedHistoryExpired(latest, Date.now()) && history.length) {
    await clearHistory();
    history = [];
  }
  return {
    status: latest.status,
    receivedAt: latest.receivedAt,
    history,
  };
}

/** 最近一次推送的到达时刻，0 表示从没收到过推送 */
export async function lastPushReceivedAt() {
  const raw = await withRedis(async (redis) => redis.get(K_LAST_PUSH), null);
  const fromRedis = raw ? Number(raw) : 0;
  return Math.max(fromRedis || 0, fallback.lastPushAt);
}

/** v2 heartbeat keeps liveness fresh without resending an unchanged charger snapshot. */
export async function recordPushHeartbeat(receivedAt = Date.now()) {
  fallback.lastPushAt = receivedAt;
  await withRedis(
    async (redis) => redis.set(K_LAST_PUSH, String(receivedAt), "PX", TTL_MS),
    null,
  );
  await clearExpiredDisconnectedHistory(receivedAt);
}
