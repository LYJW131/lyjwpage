import assert from "node:assert/strict";
import test from "node:test";

import { LAG_KEYS, installLagReader, readLag, writeLag } from "@shared/lag";
import { LAG_VIEW_LOADERS, serveLagStatus } from "@shared/lag-views";
import { STATUS_VIEWS, type LagViewKey } from "@shared/status-views";
import { MemoryKv } from "@shared/testing/memory-kv";

import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";
import { statusLoaders } from "./status-loaders";

const LAG_VIEWS = Object.keys(LAG_VIEW_LOADERS) as LagViewKey[];

test("可滞后视图在 core 与 site 用同一份 loader", () => {
  const registered = Object.entries(STATUS_VIEWS).filter(([, view]) => view.layer === "lag").map(([key]) => key);
  assert.deepEqual([...LAG_VIEWS].sort(), registered.sort());
  for (const key of LAG_VIEWS) assert.equal(statusLoaders[key].endpoint, LAG_VIEW_LOADERS[key], key);
});

test("同一份 KV，core 与 site 回的可滞后信封逐字一致，且都不碰 StateHub", async (t) => {
  const now = 1_800_000_000_000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const kv = new MemoryKv();
  const at = now - 60_000;
  await writeLag(kv, LAG_KEYS.server, { hostname: "misaka-jp", publicIp: "203.0.113.7", pushedAt: at }, at);
  await writeLag(kv, LAG_KEYS.workouts, { items: [{ id: "w1", activityType: "Running", averageHeartRateBpm: 120 }] }, at);
  await writeLag(kv, LAG_KEYS.activity, { secondsFromGMT: 28_800, date: "2027-01-15", moveKcal: 320 }, at);
  await writeLag(kv, LAG_KEYS.limits, { rows: [] }, at);
  await writeLag(kv, LAG_KEYS.timezone, { timezone: null }, at);
  await writeLag(kv, LAG_KEYS.reporterAgents, { lastPushAt: at }, at);
  await writeLag(kv, LAG_KEYS.githubChart, { origin: "2026-01-01", counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, at);
  installLagReader((key) => readLag(kv, key));
  t.after(() => installLagReader(null));

  const hubCalls: string[] = [];
  const hub = new Proxy({}, {
    get: (_, method: string) => method === "then" ? undefined : async () => {
      hubCalls.push(method);
      return [];
    },
  });
  const env = {
    STATE: { idFromName: () => ({}), get: () => hub },
    ALLOWED_ORIGINS: "https://lyjw.me",
  } as unknown as Env;

  for (const key of LAG_VIEWS) {
    const path = `${STATUS_VIEWS[key].path}${key === "githubChart" ? "?since=2026-01-08" : ""}`;
    const viaCore = await executePublicRequest(new Request(`https://api.test${path}`), env, { waitUntil: () => {} });
    const viaSite = await serveLagStatus(new Request(`https://lyjw.me${path}`), key, env);
    assert.equal(viaSite.status, viaCore.status, key);
    assert.deepEqual(await viaSite.json(), await viaCore.json(), key);
  }
  assert.deepEqual(hubCalls, []);
});
