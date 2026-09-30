import { readLag, type LagEntry, type LagKey } from "@shared/lag";
import { currentContext } from "./runtime";

export async function readLagEntry<T>(key: LagKey): Promise<LagEntry<T> | null> {
  const kv = currentContext().env.LAG;
  return kv ? readLag<T>(kv, key) : null;
}

export function installLagStoreForTests(): void {}
