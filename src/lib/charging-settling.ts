import { key, withRedis } from "@/lib/redis";

/**
 * 插拔之后那段「读数还在跳」的窗口。
 *
 * 采集端在结构变化后会追发几次（上报器的 chargingBurst），因为 PD 协商完成、
 * 设备自己调整取电都要几十秒，插上那一瞬间的那一帧往往还是 0W 或一个中间值。
 *
 * 但服务端只在**结构**变化时推实时事件 —— 而追发期间变的恰恰是功率，不是结构。
 * 于是新数据一路送到了服务端，浏览器却还在等它自己的 30 秒轮询，追发白做了。
 *
 * 所以这里把同一个窗口在服务端也开一次：结构一变就记下时刻，此后这段时间内
 * 每一次上报都照推。窗口是有限的 —— 充电中功率一直在小幅滚动，不设上限就等于
 * 把实时通道变成定时广播，那正是结构指纹当初要避免的事。
 */

/**
 * 比上报器那五次追发（约 25 秒）留出一点余量，覆盖最后一次追发的往返。
 * 短于它的话最后几帧又会掉回轮询，而那几帧恰恰是最接近稳定值的。
 */
const SETTLING_MS = 35_000;

function settlingKey(device: string) {
  return key(device, "structuralAt");
}

export type ChargingDevice = "charger" | "powerbank";

/**
 * 上一次结构变化的时刻，0 表示没有（也包括 Redis 答不上话）。
 *
 * 读和判断拆开，是为了让这一条能和这封信封的其它读一起发车 —— 从前它夹在
 * 「落库」和「推送」中间，是推送前最后一个白等的往返。调用方在信封解析完就
 * 该调它，揣着 promise 往下走。
 *
 * 结构真变了的话这次读是白读的（那种情况不看窗口），但它和别的读在同一批里，
 * 多花的是 Redis 的一点点力气，不是一个来回。
 */
export function askSettlingAt(device: ChargingDevice): Promise<number> {
  return withRedis(async (redis) => {
    const raw = await redis.get(settlingKey(device));
    return raw ? Number(raw) || 0 : 0;
  }, 0);
}

/**
 * 这一次要不要推，以及窗口的起点要不要挪到现在。
 *
 * `structuralChanged` 为真时必推，并重开窗口；否则看是否还落在上一次结构变化
 * 的窗口里。
 *
 * Redis 不可达时 `since` 是 0，于是自动退化成「只在结构变化时推」—— 那正是
 * 没有这套机制时的行为，比在故障期间把每一帧都广播出去要安全，不用特判。
 */
export function settlingDecision(
  structuralChanged: boolean,
  receivedAt: number,
  since: number,
): { publish: boolean; restart: boolean } {
  if (structuralChanged) return { publish: true, restart: true };
  return {
    publish: Boolean(since) && receivedAt - since <= SETTLING_MS,
    restart: false,
  };
}

/** 重开窗口。和推送同时发车，见 lib/live-events 的 fanout */
export function writeSettlingAt(device: ChargingDevice, receivedAt: number): Promise<unknown> {
  return withRedis(
    async (redis) => redis.set(settlingKey(device), String(receivedAt), "PX", SETTLING_MS),
    null,
  );
}
