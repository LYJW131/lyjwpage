import assert from "node:assert/strict";
import test from "node:test";
import { GatewayState } from "./gateway-state.ts";
import { VerifiedHeartbeat } from "./heartbeat.ts";
import { ReportQueue } from "./report-queue.ts";
import type { MembershipResult } from "./membership.ts";
import type { PresenceReport } from "./presence.ts";

const presence = { guild_id: "456", user: { id: "123" }, status: "online", activities: [{ name: "Beat Saber", type: 0, platform: "meta_quest" }] };
const update = { t: "PRESENCE_UPDATE", d: presence };
const readyState = () => { const state = new GatewayState("123"); state.markReady(); state.accept(update, 100); return state; };

function deferredMembership() {
  let resolve!: (result: MembershipResult) => void;
  const promise = new Promise<MembershipResult>((done) => { resolve = done; });
  return { promise, resolve };
}

test("heartbeats require present membership and allocate their observation time after verification", async () => {
  const state = readyState();
  const sent: PresenceReport[] = [];
  const heartbeat = new VerifiedHeartbeat(state, async (guild) => { assert.equal(guild, "456"); return "present"; }, (report) => { sent.push(report); });
  await heartbeat.tick(100);
  assert.equal(sent[0]?.observedAt, 101);
  assert.equal(sent[0]?.playing?.name, "Beat Saber");
});

test("membership errors do not renew heartbeat or allocate timestamps", async () => {
  const state = readyState();
  const heartbeat = new VerifiedHeartbeat(state, async () => "unknown", () => { throw new Error("must not deliver"); });
  await heartbeat.tick(500);
  assert.equal(state.accept(update, 100)?.observedAt, 101);
});

test("missing membership aborts the active request and discards queued heartbeats", async () => {
  const sent: number[] = [];
  const succeeded: number[] = [];
  const queue = new ReportQueue(async (report, signal) => {
    sent.push(report.observedAt);
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    return { changed: true };
  }, (_result, { presence: report }) => { succeeded.push(report.observedAt); }, (error) => { throw error; });
  const state = new GatewayState("123", () => queue.clear());
  state.markReady();
  const first = state.accept(update, 100);
  assert.ok(first);
  const done = queue.enqueue(first, "presence");
  const pending = state.heartbeat(200);
  assert.ok(pending);
  queue.enqueue(pending, "heartbeat");
  const heartbeat = new VerifiedHeartbeat(state, async () => "absent", () => { throw new Error("must not deliver"); });
  await heartbeat.tick(300);
  await done;
  assert.deepEqual(sent, [100]);
  assert.deepEqual(succeeded, []);
  assert.equal(state.heartbeat(400), null);
});

for (const result of ["present", "absent"] as const) {
  test(`stale ${result} membership results cannot affect a newer snapshot even in the same guild`, async () => {
    const state = readyState();
    const membership = deferredMembership();
    const sent: PresenceReport[] = [];
    const heartbeat = new VerifiedHeartbeat(state, () => membership.promise, (report) => { sent.push(report); });
    const done = heartbeat.tick(500);
    state.accept({ ...update, d: { ...presence, activities: [] } }, 100);
    membership.resolve(result);
    await done;
    assert.equal(sent.length, 0);
    assert.equal(state.heartbeat(100)?.observedAt, 102);
    assert.equal(state.heartbeat(103)?.playing, null);
  });
}

for (const change of ["reconnect", "guild change"] as const) {
  test(`membership result is discarded after ${change}`, async () => {
    const state = readyState();
    const membership = deferredMembership();
    const heartbeat = new VerifiedHeartbeat(state, () => membership.promise, () => { throw new Error("must not deliver"); });
    const done = heartbeat.tick(500);
    if (change === "reconnect") { state.disconnect(); state.markReady(); }
    else state.accept({ ...update, d: { ...presence, guild_id: "789" } }, 200);
    membership.resolve("present");
    await done;
    if (change === "reconnect") assert.equal(state.heartbeat(600), null);
    else assert.equal(state.heartbeat(201)?.observedAt, 201);
  });
}

test("one bounded membership check at a time and no checks for unknown snapshots", async () => {
  const state = new GatewayState("123");
  const membership = deferredMembership();
  let checks = 0;
  const heartbeat = new VerifiedHeartbeat(state, () => { checks += 1; return membership.promise; }, () => {});
  await heartbeat.tick(100);
  state.markReady();
  await heartbeat.tick(100);
  assert.equal(checks, 0);
  state.accept(update, 100);
  const first = heartbeat.tick(200);
  await heartbeat.tick(300);
  assert.equal(checks, 1);
  membership.resolve("present");
  await first;
});
