import assert from "node:assert/strict";
import test from "node:test";

import { DESIGN_SESSION_GRACE_MS, deleteExpiredDesignSessions } from "./chat/design-cleanup.ts";
import type { Env } from "./runtime.ts";

function fakeEnv(expired: string[], failures = new Set<string>()) {
  const disposed: string[] = [];
  const forgotten: string[] = [];
  let before = 0;
  let limit = 0;
  const env = {
    BUILD_COORDINATOR: {
      getByName: () => ({
        expiredDesignSessions: async (cutoff: number, max: number) => { before = cutoff; limit = max; return expired; },
        forgetDesignSession: async (id: string) => { forgotten.push(id); },
      }),
    },
    DESIGN_SESSIONS: {
      getByName: (id: string) => ({
        disposeSession: async () => {
          if (failures.has(id)) throw new Error("disposal failed");
          disposed.push(id);
        },
      }),
    },
  } as unknown as Env;
  const seen = { disposed, forgotten };
  Object.defineProperty(seen, "query", { get: () => ({ before, limit }) });
  return { env, ...seen, query: () => ({ before, limit }) };
}

test("名册里过期的会话逐个 dispose 后除名", async () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const { env, disposed, forgotten, query } = fakeEnv(["a", "b", "c"]);
  assert.equal(await deleteExpiredDesignSessions(env, now), 3);
  assert.deepEqual(disposed, ["a", "b", "c"]);
  assert.deepEqual(forgotten, ["a", "b", "c"]);
  assert.deepEqual(query(), { before: now - DESIGN_SESSION_GRACE_MS, limit: 100 });
});

test("删除失败的会话留在名册里下轮重试，后面的继续删", async () => {
  const { env, disposed, forgotten } = fakeEnv(["a", "b", "c"], new Set(["b"]));
  assert.equal(await deleteExpiredDesignSessions(env), 2);
  assert.deepEqual(disposed, ["a", "c"]);
  assert.deepEqual(forgotten, ["a", "c"]);
});

test("缺绑定时不查也不删", async () => {
  assert.equal(await deleteExpiredDesignSessions({} as Env), 0);
});
