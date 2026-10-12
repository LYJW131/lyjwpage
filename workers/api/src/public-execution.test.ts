import assert from "node:assert/strict";
import test from "node:test";
import { installLagReader } from "@shared/lag";
import { LAG_KEYS } from "@shared/lag";
import { installApiPorts } from "./ports";
import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";

installApiPorts();

function harness(ready: boolean) {
  const calls: string[] = [];
  const hub = new Proxy({}, {
    get: (_, method: string) => method === "then" ? undefined : async () => {
      calls.push(method);
      return method === "publicRead" ? (ready ? [] : null) : [];
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
  installLagReader(async (key) =>
    key === LAG_KEYS.server ? { updatedAt: Date.now(), data: { hosts: [] } } : null,
  );
  t.after(() => installLagReader(null));
  const { calls, run } = harness(false);
  const response = await run("/api/status/server");
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { ok: boolean }).ok, true);
  assert.deepEqual(calls, []);
});

test("实时层与开着注入的端点都不再单独调用屏障", async (t) => {
  const previous = process.env.DEV_OVERRIDES;
  t.after(() => {
    if (previous === undefined) delete process.env.DEV_OVERRIDES;
    else process.env.DEV_OVERRIDES = previous;
  });
  for (const [overrides, path] of [["false", "/api/status/charger"], ["true", "/api/status/server"]] as const) {
    process.env.DEV_OVERRIDES = overrides;
    const { calls, run } = harness(true);
    await run(path);
    assert.equal(calls.includes("publicBarrier"), false, path);
  }
});
