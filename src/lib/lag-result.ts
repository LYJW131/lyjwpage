import { AwaitingReport } from "@/lib/awaiting-report";
import { readLagEntry } from "@/lib/lag-store";
import type { LagKey } from "@shared/lag";

/**
 * 可滞后层 loader 的返回值：数据本身加写入方最后一次成功取到它的时刻。
 * `statusEnvelope` 认出它，把 `updatedAt` 放进信封（见 lib/types 的 StatusResponse）。
 */
export class LagResult<T> {
  readonly data: T;
  readonly updatedAt: number;
  constructor(data: T, updatedAt: number) {
    this.data = data;
    this.updatedAt = updatedAt;
  }

  /** 换一个形状（切片、合并），时刻不变 */
  map<U>(transform: (data: T) => U): LagResult<U> {
    return new LagResult(transform(this.data), this.updatedAt);
  }
}

/** 读一条可滞后层数据；还没有写入过就是「等上报」，端点回 ok:false */
export async function loadLag<T>(key: LagKey, awaiting: string): Promise<LagResult<T>> {
  const entry = await readLagEntry<T>(key);
  if (!entry) throw new AwaitingReport(awaiting);
  return new LagResult(entry.data, entry.updatedAt);
}
