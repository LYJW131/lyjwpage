import assert from "node:assert/strict";
import test from "node:test";
import { installLagStoreForTests } from "../../../src/lib/lag-store";
import { LAG_KEYS } from "@shared/lag";
import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";

function harness(ready: boolean) {
  const calls: string[] = [];
  const hub = new Proxy({}, {
    get: (_, method: string) => method === "then" ? undefined : async () => {
      calls.push(method);
      return method === "publicBarrier" ? ready : [];
    },
  });
  const env = {
    STATE: { idFromName: () => ({}), get: () => hub },
  } as unknown as Env;
  const run = (path: string) =>
    executePublicRequest(new Request(`https://api.test${path}`), env, { waitUntil: () => {} });
  return { calls, run };
}

test("可滞后层端点只读 KV，不调用 StateHub", async (t) => {
  installLagStoreForTests(async (key) =>
    key === LAG_KEYS.server ? { updatedAt: Date.now(), data: { hosts: [] } } : null,
  );
  t.after(() => installLagStoreForTests(null));
  const { calls, run } = harness(false);
  const response = await run("/api/status/server");
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { ok: boolean }).ok, true);
  assert.deepEqual(calls, []);
});

test("coding 年度视图从 KV 镜像读出，不调用 StateHub", async (t) => {
  installLagStoreForTests(async (key) =>
    key === LAG_KEYS.codingYear ? { updatedAt: 7, data: { updatedAt: 7, days: {} } } : null,
  );
  t.after(() => installLagStoreForTests(null));
  const { calls, run } = harness(false);
  const body = (await (await run("/api/status/coding/year")).json()) as { ok: boolean; updatedAt: number };
  assert.equal(body.ok, true);
  assert.equal(body.updatedAt, 7);
  assert.deepEqual(calls, []);
});

test("实时层端点先过 StateHub 屏障", async () => {
  const { calls, run } = harness(false);
  const response = await run("/api/status/desktop");
  assert.equal(response.status, 503);
  assert.deepEqual(calls, ["publicBarrier"]);
});

test("开着假数据注入时可滞后层端点也过屏障", async (t) => {
  const previous = process.env.DEV_OVERRIDES;
  process.env.DEV_OVERRIDES = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.DEV_OVERRIDES;
    else process.env.DEV_OVERRIDES = previous;
  });
  const { calls, run } = harness(false);
  const response = await run("/api/status/server");
  assert.equal(response.status, 503);
  assert.deepEqual(calls, ["publicBarrier"]);
});
