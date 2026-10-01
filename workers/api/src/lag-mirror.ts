import { key } from "@/lib/storage";
import { codingViewKey, codingYearKey, parseStoredView, parseStoredYear } from "@shared/coding-store";
import { LAG_KEYS, writeLag, type LagKey, type LagStore } from "@shared/lag";
import type { StorageBatch, StorageClient } from "@shared/storage-client";

type Mirror = { lag: LagKey; source: () => string; parse: (raw: unknown) => unknown };

const MIRRORS: readonly Mirror[] = [
  { lag: LAG_KEYS.codingUsage, source: codingViewKey, parse: parseStoredView },
  { lag: LAG_KEYS.codingYear, source: codingYearKey, parse: parseStoredYear },
];

export const LAG_MIRROR_SET = MIRRORS.map((mirror) => mirror.lag).join(",");

const pendingKey = (lag: LagKey) => key("lag-mirror", "pending", lag);

// 待写标记必须与源视图同一批提交，KV 写失败后才能凭它补写。
export function markLagPending(batch: StorageBatch, ...lags: LagKey[]): StorageBatch {
  for (const lag of lags) batch.set(pendingKey(lag), "1");
  return batch;
}

export function markAllLagPending(batch: StorageBatch): StorageBatch {
  return markLagPending(batch, ...MIRRORS.map((mirror) => mirror.lag));
}

// 调用方须与提交串行，否则清标记可能盖掉并发提交刚设的新标记。返回是否仍有未写成的镜像。
export async function flushLagMirrors(storage: StorageClient, kv: LagStore | undefined, now = Date.now()): Promise<boolean> {
  if (!kv) return false;
  const read = storage.batch();
  for (const mirror of MIRRORS) read.get(pendingKey(mirror.lag)).get(mirror.source());
  const rows = await read.execute();
  const done = storage.batch();
  let failed = false;
  await Promise.all(MIRRORS.map(async (mirror, index) => {
    if (rows[index * 2] == null) return;
    const data = mirror.parse(rows[index * 2 + 1]);
    try {
      if (data != null) await writeLag(kv, mirror.lag, data, now);
      done.remove(pendingKey(mirror.lag));
    } catch (error) {
      failed = true;
      console.warn("[lag-mirror]", mirror.lag, error instanceof Error ? error.message : String(error));
    }
  }));
  await done.execute();
  return failed;
}
