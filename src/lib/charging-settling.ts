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

/**
 * 记一次上报，返回这一次要不要推给前端。
 *
 * `structuralChanged` 为真时必推，并把窗口的起点挪到现在；否则看是否还在上一次
 * 结构变化的窗口里。
 *
 * Redis 不可达时退化成「只在结构变化时推」—— 那是没有这套机制时的行为，
 * 比在故障期间把每一帧都广播出去要安全。
 */
export async function shouldPublishCharging(
  device: "charger" | "powerbank",
  structuralChanged: boolean,
  receivedAt: number,
): Promise<boolean> {
  const storeKey = settlingKey(device);

  if (structuralChanged) {
    await withRedis(
      async (redis) => redis.set(storeKey, String(receivedAt), "PX", SETTLING_MS),
      null,
    );
    return true;
  }

  const raw = await withRedis(async (redis) => redis.get(storeKey), null);
  const since = raw ? Number(raw) : 0;
  return Boolean(since) && receivedAt - since <= SETTLING_MS;
}
