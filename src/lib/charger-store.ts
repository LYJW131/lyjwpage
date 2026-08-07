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

/**
 * 历史点数上限。
 * 必须保证「即使按最密的采样间隔，也能盖满曲线的时间窗」，否则曲线左边会空
 * 一截：400 × MIN_SAMPLE_GAP(5s) = 33 分钟 > 窗口 20 分钟。
 * 改这里要和 sparkline.tsx 的 WINDOW_MS 一起看。
 */
const HISTORY_LIMIT = 400;

/**
 * 两个采样点之间的最小间隔，用来控制曲线的时间跨度。
 *
 * 采集端本身是 1 Hz，但上报按节流窗口走（默认 30 秒），所以到这里的间隔由
 * 上报间隔决定、通常已经大于这个阈值 —— 它真正拦的是即时上报：插拔、播放
 * 变化会把充电器快照顺带捎出去，那些不该在曲线上挤成一团。
 * 要拉长曲线跨度就调大它，或者调 HISTORY_LIMIT。
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

/**
 * 「结构性」指纹：插拔、换设备、换充电器本身。
 *
 * 刻意只取设备身份，不取 `active` / `protocol` / `cable` —— 那三个在采集端都是
 * 功率派生的（`active` 就是 `power > 0.2`，另两个挂在同样功率派生的口内部状态上），
 * 涓流充电在阈值上下摆一摆就会翻。拿它们当判据会把即时推送打成定时推送，
 * 而功率、电压、电流的滚动本来就该走卡片自己的轮询。
 */
function structuralKey(status: ChargerStatus) {
  return JSON.stringify([
    status.connected,
    status.device.serialNumber,
    status.device.firmwareVersion,
    status.ports.map((port) => [port.id, port.device]),
  ]);
}

/**
 * 记一条快照。同一个 updatedAt 重复推送不会产生重复采样点。
 *
 * 返回结构性内容变没变，调用方据此决定要不要往 SSE 推。这个 diff 必须服务端
 * 自己做：充电时采集端每个上报周期都会带 charger 模块（功率两位小数必变），
 * 收到就推的话 SSE 会退化成定时推送，「插拔即时」也就没了意义。
 */
export async function recordStatus(status: ChargerStatus, receivedAt = Date.now()) {
  const previous = await readLatest();
  // 第一份快照也算变化：客户端手上还什么都没有，该收到一次
  const structuralChanged =
    !previous || structuralKey(previous.status) !== structuralKey(status);

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

  // 同一帧被推两次时不重复记。采集端现在是 1 Hz 推流，每帧都会换 updated_at，
  // 所以这道判断只在重试或重复投递时才拦得住东西 —— 留着是因为那才是它的本意。
  if (
    previous &&
    status.updatedAt != null &&
    previous.status.updatedAt === status.updatedAt
  ) {
    return structuralChanged;
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
      return structuralChanged;
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

  return structuralChanged;
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

/** v2 heartbeat keeps liveness fresh without resending an unchanged charger snapshot. */
export async function recordPushHeartbeat(receivedAt = Date.now()) {
  fallback.lastPushAt = receivedAt;
  await withRedis(
    async (redis) => redis.set(K_LAST_PUSH, String(receivedAt), "PX", TTL_MS),
    null,
  );
}
