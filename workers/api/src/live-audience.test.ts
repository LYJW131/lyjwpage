import assert from "node:assert/strict";
import test from "node:test";

import { effectsForAudience, type IngestEffect } from "./ingest-effects.ts";
import { AudienceSync } from "./live-audience.ts";

function fakeHub({ told }: { told?: boolean } = {}) {
  const state = { told, hub: [] as boolean[], gate: null as null | { open: () => void; wait: Promise<void> }, fail: 0 };
  const hold = () => {
    let open = () => {};
    const wait = new Promise<void>((resolve) => { open = resolve; });
    state.gate = { open, wait };
  };
  const sync = new AudienceSync({
    told: async () => state.told,
    tell: async (watched) => {
      if (state.gate) await state.gate.wait;
      if (state.fail > 0) {
        state.fail -= 1;
        throw new Error("hub unreachable");
      }
      state.hub.push(watched);
    },
    remember: async (watched) => { state.told = watched; },
  });
  return { state, sync, hold };
}

test("从没人到有人、从有人到没人各通知一次", async () => {
  const { state, sync } = fakeHub({ told: false });
  await sync.update(true);
  await sync.update(false);
  assert.deepEqual(state.hub, [true, false]);
  assert.equal(state.told, false);
});

test("人数在有人之间变化不调 StateHub", async () => {
  const { state, sync } = fakeHub({ told: true });
  for (let i = 0; i < 5; i += 1) await sync.update(true);
  assert.deepEqual(state.hub, []);
});

test("房间第一次清点也要告诉 StateHub，哪怕结果是有人", async () => {
  const { state, sync } = fakeHub();
  await sync.update(true);
  assert.deepEqual(state.hub, [true]);
});

test("通知在途时人数来回翻转：不并发，最终落在最新状态", async () => {
  const { state, sync, hold } = fakeHub({ told: true });
  hold();
  const first = sync.update(false);
  await new Promise((resolve) => setImmediate(resolve));
  const second = sync.update(true);
  const third = sync.update(false);
  assert.equal(second, first);
  assert.equal(third, first);
  state.gate?.open();
  state.gate = null;
  await first;
  assert.deepEqual(state.hub, [false]);
  assert.equal(state.told, false);
});

test("在途通知结束前翻回去，会补发一次", async () => {
  const { state, sync, hold } = fakeHub({ told: false });
  hold();
  const pending = sync.update(true);
  await new Promise((resolve) => setImmediate(resolve));
  void sync.update(false);
  void sync.update(true);
  void sync.update(false);
  state.gate?.open();
  state.gate = null;
  await pending;
  assert.deepEqual(state.hub, [true, false]);
  assert.equal(state.told, false);
});

test("通知失败不记账，下一次清点重试", async () => {
  const { state, sync } = fakeHub({ told: false });
  state.fail = 1;
  await assert.rejects(sync.update(true), /hub unreachable/);
  assert.equal(state.told, false);
  await sync.update(true);
  assert.deepEqual(state.hub, [true]);
  assert.equal(state.told, true);
});

test("没人在看时只留首屏失效，推送事件和正在听全部丢掉", () => {
  const effects: IngestEffect[] = [
    { kind: "event", event: { type: "presence", payload: null } },
    { kind: "listening", liveness: "online" as never, activeModules: [], homePod: null },
    { kind: "tags", tags: ["desktop"] },
  ];
  assert.deepEqual(effectsForAudience(effects, false), [{ kind: "tags", tags: ["desktop"] }]);
  assert.equal(effectsForAudience(effects, true), effects);
});
