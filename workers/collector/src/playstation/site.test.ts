import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreCommand } from "@shared/ingest/prepare";
import type { CommitReply, CorePower } from "@shared/state-core";

import type { Env } from "./env";
import { deliver, readAudience, readPower, withTimeout } from "./site";

type Core = Env["CORE"];

function environment(overrides: Partial<Core> = {}, vars: Partial<Env> = {}): Env {
  const core: Core = {
    commitIngest: async (): Promise<CommitReply> => ({ ready: true, ok: true, data: { changed: false } }),
    audience: async () => ({ connections: 3, online: 1 }),
    playstationPower: async (): Promise<CorePower> => ({ on: false, observedAt: 123 }),
    ...overrides,
  };
  return { COLLECTOR_KV: {} as KVNamespace, CORE: core, ...vars };
}

test("PS delivery prepares the envelope here and commits it through StateCore.commitIngest", async () => {
  let call: CoreCommand | undefined;
  const env = environment({
    commitIngest: async (command) => {
      call = command;
      return { ready: true, ok: true, data: { changed: true } };
    },
  });
  const before = Date.now();
  assert.deepEqual(await deliver(env, { version: 1 }), { changed: true });
  assert.equal(call?.source, "playstation");
  assert.deepEqual({ ...call, receivedAt: 0 }, { source: "playstation", receivedAt: 0, presence: null, playedGames: null, trophies: null, power: null });
  assert.ok(call.receivedAt >= before && call.receivedAt <= Date.now());
  // 命令要跨 Service Binding 结构化复制
  assert.deepEqual(structuredClone(call), call);
  assert.deepEqual(await readAudience(env), { online: 1, open: 3 });
  assert.deepEqual(await readPower(env), { on: false, observedAt: 123 });
});

test("only a ready, accepted commit counts as delivered", async () => {
  await assert.rejects(deliver(environment({ commitIngest: async () => ({ ready: true, ok: false, error: "bad envelope" }) }), { version: 1 }), /拒收：bad envelope/);
  await assert.rejects(deliver(environment({ commitIngest: async () => ({ ready: false, ok: false }) }), { version: 1 }), /还没初始化/);
  // 自己组坏了的信封在这边就被 prepare 拒掉，不去状态核心
  await assert.rejects(deliver(environment({ commitIngest: async () => { throw new Error("should not be called"); } }), { version: 2 } as never), /version 必须为 1/);
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /超时/);
});

test("dry run only logs the envelope and never calls the core", async (t) => {
  const logged = t.mock.method(console, "log", () => {});
  const env = environment({ commitIngest: async () => { throw new Error("should not be called"); } }, { PS_DRY_RUN: "true" });
  assert.deepEqual(await deliver(env, { version: 1 }), { changed: true });
  assert.equal(logged.mock.callCount(), 1);
});

test("failed and invalid reads preserve independent cadence fallbacks", async (t) => {
  t.mock.method(console, "warn", () => {});
  const failure = async (): Promise<never> => { throw new Error("unavailable"); };
  assert.deepEqual(await readAudience(environment({ audience: failure })), { online: 0, open: 0 });
  // 一个数不合法只降它自己
  assert.deepEqual(await readAudience(environment({ audience: async () => ({ connections: -1, online: 2 }) })), { online: 2, open: 0 });
  assert.deepEqual(await readAudience(environment({ audience: async () => ({ connections: 4, online: 1.5 }) })), { online: 0, open: 4 });
  // 电源读不到是「不知道」，不是关机
  assert.equal(await readPower(environment({ playstationPower: failure })), null);
  assert.equal(await readPower(environment({ playstationPower: async () => null })), null);
  assert.equal(await readPower(environment({ playstationPower: async () => ({ on: false, observedAt: Number.NaN }) })), null);
});
