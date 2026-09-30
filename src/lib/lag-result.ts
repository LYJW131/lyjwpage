import { AwaitingReport } from "@/lib/awaiting-report";
import { readLagEntry } from "@/lib/lag-store";
import type { LagKey } from "@shared/lag";

export class LagResult<T> {
  readonly data: T;
  readonly updatedAt: number;
  constructor(data: T, updatedAt: number) {
    this.data = data;
    this.updatedAt = updatedAt;
  }

  map<U>(transform: (data: T) => U): LagResult<U> {
    return new LagResult(transform(this.data), this.updatedAt);
  }
}

export async function loadLag<T>(key: LagKey, awaiting: string): Promise<LagResult<T>> {
  const entry = await readLagEntry<T>(key);
  if (!entry) throw new AwaitingReport(awaiting);
  return new LagResult(entry.data, entry.updatedAt);
}
