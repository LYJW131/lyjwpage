import type { FakeStorage } from "@shared/testing/fake-storage";
import { withRequestState } from "@shared/request-state";
import type { CoreCommand } from "@shared/ingest/prepare";

import { collectIngestEffects, type CollectedIngest } from "../ingest-effects";
import { commitPreparedIngest } from "../ingest-handlers";
import { requestStore, type Env } from "../runtime";

export const NOW = 1_800_000_000_000;
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);

export function envelope(modules: Record<string, unknown>, activeModules: string[] = []) {
  return { version: 4, presence: "online", heartbeatAt: NOW, activeModules, modules };
}

export function testEnv(): Env {
  return {
    LIVE_PUSH: {
      idFromName: () => null,
      get: () => ({ broadcast: async () => { throw new Error("DO commit must not broadcast"); } }),
    } as unknown as Env["LIVE_PUSH"],
  } as Env;
}

export async function inRequest<T>(env: Env, run: () => Promise<T>): Promise<T> {
  const pending: Promise<unknown>[] = [];
  try {
    return await requestStore.run({
      env,
      ctx: { waitUntil: (promise) => { pending.push(promise); } },
    }, () => withRequestState(run));
  } finally {
    await Promise.allSettled(pending);
  }
}

export async function commit(env: Env, command: CoreCommand): Promise<CollectedIngest<unknown>> {
  return inRequest(env, () => collectIngestEffects(() => commitPreparedIngest(command)));
}

export async function fieldsOf(storage: FakeStorage, name: string): Promise<Record<string, string>> {
  return (await storage.batch().fields(name).execute())[0] as Record<string, string>;
}
