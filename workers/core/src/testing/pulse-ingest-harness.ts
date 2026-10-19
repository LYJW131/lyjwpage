
import {
  pulseLaneKey,
  pulseLaneOpenKey,
} from "../pulse-keys";
import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import { withRequestState } from "@shared/request-state";
import type { StateLane } from "@shared/pulse-timeline";
import { requestStore, type Env } from "@core/runtime";

export const T0 = 1_760_000_000_000;

export async function inRequest<T>(run: () => Promise<T>): Promise<T> {
  const pending: Promise<unknown>[] = [];
  const context = {
    env: {
      LIVE_PUSH: {
        idFromName: () => null,
        get: () => ({ broadcast: async () => {} }),
      },
    } as unknown as Env,
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    },
  };
  try {
    return await requestStore.run(context, () => withRequestState(run));
  } finally {
    await Promise.allSettled(pending);
  }
}

export async function closed(storage: FakeStorage, lane: StateLane) {
  return (await storage.listRange(pulseLaneKey(lane), 0, -1)).map((row) => JSON.parse(row));
}
export async function open(storage: FakeStorage, lane: StateLane) {
  const raw = await storage.get(pulseLaneOpenKey(lane));
  return raw ? JSON.parse(raw) : null;
}

export function envelope(at: number, activeModules: string[], modules?: Record<string, unknown>) {
  return { version: 4, presence: "online", heartbeatAt: at, activeModules, modules };
}

export function withStorage(run: (storage: FakeStorage) => Promise<void>) {
  return async () => {
    const storage = new FakeStorage();
    installTestStorage(storage);
    try { await run(storage); } finally { installTestStorage(null); }
  };
}
