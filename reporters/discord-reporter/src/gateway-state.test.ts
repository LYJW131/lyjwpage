import assert from "node:assert/strict";
import test from "node:test";
import { GatewayState } from "./gateway-state.ts";

const target = "123";
const guild = "guild-1";
const presence = { guild_id: guild, user: { id: target }, status: "online", activities: [{ name: "Beat Saber", type: 0, platform: "meta_quest" }] };
const update = { t: "PRESENCE_UPDATE", d: presence };

test("ready without a target snapshot cannot report or heartbeat", () => {
  const state = new GatewayState(target);
  assert.equal(state.markReady(), null);
  assert.equal(state.heartbeat(100), null);
  assert.equal(state.accept({ ...update, d: { ...presence, user: { id: "456" } } }, 101), null);
  assert.equal(state.heartbeat(102), null);
});

test("initial GUILD_CREATE snapshot waits for ready and keeps its original observation time", () => {
  const state = new GatewayState(target);
  assert.equal(state.accept({ t: "GUILD_CREATE", d: { id: guild, presences: [presence] } }, 100), null);
  assert.equal(state.heartbeat(101), null);
  const first = state.markReady();
  assert.equal(first?.playing?.name, "Beat Saber");
  assert.equal(first?.observedAt, 100);
  assert.equal(state.markReady(), null);
  assert.equal(state.heartbeat(102)?.observedAt, 102);
});

test("disconnect and resume cannot refresh an old activity until a new target snapshot arrives", () => {
  const state = new GatewayState(target);
  state.markReady();
  assert.equal(state.accept(update, 100)?.playing?.name, "Beat Saber");
  state.disconnect();
  assert.equal(state.heartbeat(200), null);
  assert.equal(state.markReady(), null);
  assert.equal(state.heartbeat(300), null);
  state.accept({ t: "GUILD_CREATE", d: { id: guild, members: [], presences: [] } }, 400);
  assert.equal(state.heartbeat(500), null);
  assert.equal(state.accept(update, 600)?.observedAt, 600);
  assert.equal(state.heartbeat(700)?.playing?.name, "Beat Saber");
});

test("fresh snapshot received while reconnecting is eligible only after ready", () => {
  const state = new GatewayState(target);
  state.markReady();
  state.accept(update, 100);
  state.disconnect();
  assert.equal(state.accept({ ...update, d: { ...presence, activities: [] } }, 200), null);
  assert.equal(state.heartbeat(300), null);
  assert.equal(state.markReady()?.playing, null);
});

test("guild absence proves offline only when target membership is present", () => {
  const state = new GatewayState(target);
  state.markReady();
  for (const d of [{ presences: [] }, { members: [], presences: [] }, { members: [{ user: { id: target } }] },
    { unavailable: true, members: [{ user: { id: target } }], presences: [] }]) {
    assert.equal(state.accept({ t: "GUILD_CREATE", d: { id: guild, ...d } }, 100), null);
    assert.equal(state.heartbeat(200), null);
  }
  assert.deepEqual(state.accept({ t: "GUILD_CREATE", d: { id: guild, members: [{ user: { id: target } }], presences: [] } }, 300),
    { observedAt: 300, discordStatus: "offline", playing: null });
});

test("an inferred offline snapshot from another guild does not erase known activity", () => {
  const state = new GatewayState(target);
  state.markReady();
  state.accept(update, 100);
  assert.equal(state.accept({ t: "GUILD_CREATE", d: { id: guild, members: [{ user: { id: target } }], presences: [] } }, 200), null);
  assert.equal(state.heartbeat(300)?.playing?.name, "Beat Saber");
});

for (const packet of [
  { t: "GUILD_DELETE", d: { id: guild } },
  { t: "GUILD_DELETE", d: { id: guild, unavailable: true } },
  { t: "GUILD_CREATE", d: { id: guild, unavailable: true } },
  { t: "GUILD_MEMBER_REMOVE", d: { guild_id: guild, user: { id: target } } },
]) {
  test(`${packet.t} ${JSON.stringify(packet.d)} revokes the source snapshot until a fresh target observation`, () => {
    let invalidations = 0;
    const state = new GatewayState(target, () => { invalidations += 1; });
    state.markReady();
    state.accept(update, 100);
    assert.equal(state.accept(packet, 200), null);
    assert.equal(invalidations, 1);
    assert.equal(state.heartbeat(300), null);
    assert.equal(state.markReady(), null);
    assert.equal(state.heartbeat(400), null);
    assert.equal(state.accept(update, 500)?.observedAt, 500);
    assert.equal(state.heartbeat(600)?.playing?.name, "Beat Saber");
  });
}

test("unrelated guild and member removals do not revoke the current source", () => {
  const state = new GatewayState(target, () => { throw new Error("unexpected invalidation"); });
  state.markReady();
  state.accept(update, 100);
  for (const packet of [
    { t: "GUILD_DELETE", d: { id: "other" } },
    { t: "GUILD_CREATE", d: { id: "other", unavailable: true } },
    { t: "GUILD_MEMBER_REMOVE", d: { guild_id: guild, user: { id: "other" } } },
    { t: "GUILD_MEMBER_REMOVE", d: { guild_id: "other", user: { id: target } } },
  ]) state.accept(packet, 200);
  assert.equal(state.heartbeat(300)?.playing?.name, "Beat Saber");
});

test("GUILD_CREATE snapshot source is tracked and a newer guild snapshot replaces its authority", () => {
  let invalidations = 0;
  const state = new GatewayState(target, () => { invalidations += 1; });
  state.markReady();
  state.accept({ t: "GUILD_CREATE", d: { id: guild, presences: [presence] } }, 100);
  state.accept({ ...update, d: { ...presence, guild_id: "other" } }, 200);
  state.accept({ t: "GUILD_DELETE", d: { id: guild } }, 300);
  assert.equal(invalidations, 0);
  assert.equal(state.heartbeat(400)?.playing?.name, "Beat Saber");
  state.accept({ t: "GUILD_DELETE", d: { id: "other" } }, 500);
  assert.equal(invalidations, 1);
  assert.equal(state.heartbeat(600), null);
});

test("same millisecond state changes and heartbeats receive strictly increasing observation times", () => {
  const state = new GatewayState(target);
  state.markReady();
  const playing = state.accept(update, 100);
  const stopped = state.accept({ ...update, d: { ...presence, activities: [] } }, 100);
  const heartbeat = state.heartbeat(100);
  assert.deepEqual([playing?.observedAt, stopped?.observedAt, heartbeat?.observedAt], [100, 101, 102]);
  assert.equal(playing?.playing?.name, "Beat Saber");
  assert.equal(stopped?.playing, null);
});

test("disconnection, unknown input and unrelated events cannot allocate new observation times", () => {
  const state = new GatewayState(target);
  state.markReady();
  assert.equal(state.accept(update, 100)?.observedAt, 100);
  state.disconnect();
  assert.equal(state.heartbeat(500), null);
  state.markReady();
  assert.equal(state.heartbeat(600), null);
  state.accept({ ...update, d: { ...presence, user: { id: "other" } } }, 700);
  state.accept({ ...update, d: { ...presence, status: "bad" } }, 800);
  assert.equal(state.heartbeat(900), null);
  assert.equal(state.accept(update, 100)?.observedAt, 101);
});
