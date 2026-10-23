import assert from "node:assert/strict";
import test from "node:test";

import type { LiveEvent } from "@shared/live-events";
import {
  collectIngestEffects,
  collectListeningEffect,
  collectSerializableEffects,
  dispatchIngestEffects,
  type IngestEffect,
  type ListeningEffect,
} from "./ingest-effects";
import { requestStore, type Env } from "./runtime";
import { immediatePurgeHub } from "./testing/ingest-harness";

const EVENT: LiveEvent = { type: "presence", payload: null };
const ONLINE: LiveEvent = { type: "online", payload: { online: 3 } };

const LISTENING: ListeningEffect = {
  kind: "listening",
  liveness: { lastSeenAt: 0, declaredOffline: false },
  activeModules: [],
  homePod: null,
};

test("收集器之外的效果收集直接落空", () => {
  assert.equal(collectSerializableEffects([EVENT], ["charger"]), false);
  assert.equal(collectListeningEffect(LISTENING), false);
});

test("成功的 run 把返回值和收集的效果一起带回", async () => {
  const collected = await collectIngestEffects(async () => {
    collectSerializableEffects([EVENT], []);
    return 42;
  });
  assert.deepEqual(collected, {
    ok: true,
    value: 42,
    effects: [{ kind: "event", event: EVENT }],
  });
});

test("失败结果也把已收集的效果带回来，标签去重并成一条", async () => {
  const collected = await collectIngestEffects(async () => {
    collectSerializableEffects([EVENT, ONLINE], ["charger", "charger", "powerbank"]);
    collectListeningEffect(LISTENING);
    throw new Error("写入中途失败");
  });
  assert.equal(collected.ok, false);
  assert.equal(collected.ok ? "" : collected.error, "写入中途失败");
  assert.deepEqual(collected.effects, [
    { kind: "event", event: EVENT },
    { kind: "event", event: ONLINE },
    { kind: "tags", tags: ["charger", "powerbank"] },
    LISTENING,
  ]);
});

test("非 Error 的异常也收成字符串", async () => {
  const collected = await collectIngestEffects(async () => {
    throw "boom";
  });
  assert.equal(collected.ok, false);
  assert.equal(collected.ok ? "" : collected.error, "boom");
});

function fakeEnv() {
  const broadcasts: string[] = [];
  const invalidated: string[][] = [];
  const env = {
    LIVE_PUSH: {
      idFromName: (name: string) => name,
      get: () => ({ broadcast: async (raw: string) => { broadcasts.push(raw); } }),
    },
    SITE_CACHE: { invalidate: async (tags: string[]) => { invalidated.push(tags); } },
    STATE: immediatePurgeHub(),
  } as unknown as Env;
  return { env, broadcasts, invalidated };
}

async function dispatch(env: Env, effects: IngestEffect[]) {
  const pending: Promise<unknown>[] = [];
  await requestStore.run(
    { env, ctx: { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } },
    () => dispatchIngestEffects(effects),
  );
  await Promise.all(pending);
}

test("事件按序广播，标签合并去重后一次性失效，无效标签被滤掉", async () => {
  const { env, broadcasts, invalidated } = fakeEnv();
  await dispatch(env, [
    { kind: "event", event: EVENT },
    { kind: "tags", tags: ["charger", "not-a-tag", "charger"] },
    { kind: "event", event: ONLINE },
    { kind: "tags", tags: ["powerbank"] },
  ]);
  assert.deepEqual(broadcasts.map((raw) => JSON.parse(raw)), [EVENT, ONLINE]);
  assert.deepEqual(invalidated, [["charger", "powerbank"]]);
});

test("全是无效标签时不调失效，没有效果时什么都不做", async () => {
  const { env, broadcasts, invalidated } = fakeEnv();
  await dispatch(env, [{ kind: "tags", tags: ["not-a-tag"] }]);
  await dispatch(env, []);
  assert.deepEqual(broadcasts, []);
  assert.deepEqual(invalidated, []);
});
