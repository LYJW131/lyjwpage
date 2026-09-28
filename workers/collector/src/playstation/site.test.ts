import assert from "node:assert/strict";
import { test } from "node:test";

import type { CorePower, CoreReply } from "@shared/state-core";

import type { Env } from "./env";
import { deliver, headCount, readPower, withTimeout } from "./site";

type Core = Env["CORE"];

function environment(overrides: Partial<Core> = {}, vars: Partial<Env> = {}): Env {
  const core: Core = {
    ingest: async (): Promise<CoreReply> => ({ status: 202, body: { ok: true, data: { changed: false } } }),
    connections: async () => 3,
    playstationPower: async (): Promise<CorePower> => ({ on: false, observedAt: 123 }),
    ...overrides,
  };
  return { COLLECTOR_KV: {} as KVNamespace, CORE: core, ...vars };
}

test("PS delivery goes through StateCore.ingest as the playstation source", async () => {
  let call: { source: string; payload: unknown } | undefined;
  const env = environment({
    ingest: async (source, raw) => {
      call = { source, payload: JSON.parse(raw) };
      return { status: 202, body: { ok: true, data: { changed: true } } };
    },
  });
  assert.deepEqual(await deliver(env, { version: 1 }), { changed: true });
  assert.deepEqual(call, { source: "playstation", payload: { version: 1 } });
  assert.equal(await headCount(() => env.CORE.connections(), "connections"), 3);
  assert.deepEqual(await readPower(env), { on: false, observedAt: 123 });
});

test("only a 2xx reply with ok:true counts as delivered", async () => {
  await assert.rejects(deliver(environment({ ingest: async () => ({ status: 400, body: { ok: false, error: "bad envelope" } }) }), { version: 1 }), /400：bad envelope/);
  await assert.rejects(deliver(environment({ ingest: async () => ({ status: 202, body: { ok: false } }) }), { version: 1 }), /202/);
  await assert.rejects(deliver(environment({ ingest: async () => ({ status: 503, body: null }) }), { version: 1 }), /503/);
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /超时/);
});

test("dry run only logs the envelope and never calls the core", async (t) => {
  const logged = t.mock.method(console, "log", () => {});
  const env = environment({ ingest: async () => { throw new Error("should not be called"); } }, { PS_DRY_RUN: "true" });
  assert.deepEqual(await deliver(env, { version: 1 }), { changed: true });
  assert.equal(logged.mock.callCount(), 1);
});

test("failed and invalid reads preserve independent cadence fallbacks", async (t) => {
  t.mock.method(console, "warn", () => {});
  const failure = async (): Promise<never> => { throw new Error("unavailable"); };
  assert.equal(await headCount(failure, "connections"), 0);
  assert.equal(await headCount(async () => -1, "connections"), 0);
  assert.equal(await headCount(async () => 1.5, "online"), 0);
  assert.equal(await headCount(undefined, "connections"), 0);
  assert.equal(await headCount(async () => 1, "online"), 1);
  // 电源读不到是「不知道」，不是关机
  assert.equal(await readPower(environment({ playstationPower: failure })), null);
  assert.equal(await readPower(environment({ playstationPower: async () => null })), null);
  assert.equal(await readPower(environment({ playstationPower: async () => ({ on: false, observedAt: Number.NaN }) })), null);
});
