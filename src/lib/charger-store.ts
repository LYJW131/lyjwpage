import { key, withRedis } from "@/lib/redis";
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

/** 历史点数上限。按实测约 8 秒一个点算，覆盖约 24 分钟 */
const HISTORY_LIMIT = 180;

/**
 * 两个采样点之间的最小间隔，用来控制曲线的时间跨度。
 * 注意：实测对端推送间隔约 5.3 秒（不是 30 秒），所以这个阈值实际会生效，
 * 180 个点只覆盖约 24 分钟。要拉长跨度就调大它。
 */
const MIN_SAMPLE_GAP_MS = 5_000;

/** 历史和快照的保留时长，比断流阈值宽松得多，重启后仍能接上 */
const TTL_MS = 24 * 60 * 60 * 1000;

const K_LATEST = key("charger", "latest");
const K_HISTORY = key("charger", "history");
const K_LAST_PUSH = key("charger", "lastPush");

// 没有 Redis 时的退路
const fallback = {
  latest: null as ChargerStatus | null,
  receivedAt: 0,
  lastPushAt: 0,
  history: [] as ChargerSample[],
};

type Stored = { status: ChargerStatus; receivedAt: number };

async function readLatest(): Promise<Stored | null> {
  const raw = await withRedis(async (redis) => redis.get(K_LATEST), null);
  if (raw) {
    try {
      return JSON.parse(raw) as Stored;
    } catch {
      // 脏数据当作没有
    }
  }
  return fallback.latest
    ? { status: fallback.latest, receivedAt: fallback.receivedAt }
    : null;
}

async function readHistory(): Promise<ChargerSample[]> {
  const raw = await withRedis(
    async (redis) => redis.lrange(K_HISTORY, 0, -1),
    null as string[] | null,
  );
  if (raw && raw.length) {
    const parsed: ChargerSample[] = [];
    for (const item of raw) {
      try {
        parsed.push(JSON.parse(item) as ChargerSample);
      } catch {
        // 跳过坏点，不因为一条脏数据丢掉整条曲线
      }
    }
    return parsed;
  }
  return [...fallback.history];
}

/** 记一条快照。同一个 updatedAt 重复推送不会产生重复采样点 */
export async function recordStatus(status: ChargerStatus, receivedAt = Date.now()) {
  const previous = await readLatest();

  fallback.latest = status;
  fallback.receivedAt = receivedAt;
  fallback.lastPushAt = receivedAt;

  await withRedis(async (redis) => {
    const pipe = redis.pipeline();
    pipe.set(K_LATEST, JSON.stringify({ status, receivedAt }), "PX", TTL_MS);
    pipe.set(K_LAST_PUSH, String(receivedAt), "PX", TTL_MS);
    await pipe.exec();
    return null;
  }, null);

  // 上游 12 秒才换一次 updated_at，同一帧被推两次时不重复记
  if (
    previous &&
    status.updatedAt != null &&
    previous.status.updatedAt === status.updatedAt
  ) {
    return;
  }

  const history = await readHistory();
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
      return;
    }
  }

  const sample: ChargerSample = { t: at, w: status.totalPower };

  if (reset) fallback.history.length = 0;
  fallback.history.push(sample);
  if (fallback.history.length > HISTORY_LIMIT) {
    fallback.history.splice(0, fallback.history.length - HISTORY_LIMIT);
  }

  await withRedis(async (redis) => {
    const pipe = redis.pipeline();
    if (reset) pipe.del(K_HISTORY);
    pipe.rpush(K_HISTORY, JSON.stringify(sample));
    // 只留最近 HISTORY_LIMIT 条，用 Redis 自己的裁剪，不用把整条读回来重写
    pipe.ltrim(K_HISTORY, -HISTORY_LIMIT, -1);
    pipe.pexpire(K_HISTORY, TTL_MS);
    await pipe.exec();
    return null;
  }, null);
}

export async function getStored() {
  const latest = await readLatest();
  if (!latest) return null;
  return {
    status: latest.status,
    receivedAt: latest.receivedAt,
    history: await readHistory(),
  };
}

/** 最近一次推送的到达时刻，0 表示从没收到过推送 */
export async function lastPushReceivedAt() {
  const raw = await withRedis(async (redis) => redis.get(K_LAST_PUSH), null);
  const fromRedis = raw ? Number(raw) : 0;
  return Math.max(fromRedis || 0, fallback.lastPushAt);
}

