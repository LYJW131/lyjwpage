import assert from "node:assert/strict";
import test from "node:test";
import { GatewayState } from "./gateway-state.ts";
import { ReportQueue } from "./report-queue.ts";

const report = (observedAt: number) => ({ observedAt, discordStatus: "online" as const, playing: null });

test("serial reporting coalesces pending updates to the latest snapshot", async () => {
  const sent: number[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const queue = new ReportQueue(async (presence) => {
    sent.push(presence.observedAt);
    if (sent.length === 1) await blocked;
    return { changed: true };
  }, () => {}, (error) => { throw error; });
  const done = queue.enqueue(report(100), "presence");
  queue.enqueue(report(200), "presence");
  queue.enqueue(report(300), "presence");
  release();
  await done;
  assert.deepEqual(sent, [100, 300]);
});

test("disconnect drops queued old heartbeats and aborts active reporting", async () => {
  const sent: number[] = [];
  const succeeded: number[] = [];
  const queue = new ReportQueue(async (presence, signal) => {
    sent.push(presence.observedAt);
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    return { changed: true };
  }, (_result, { presence }) => { succeeded.push(presence.observedAt); }, (error) => { throw error; });
  const done = queue.enqueue(report(100), "presence");
  queue.enqueue(report(200), "heartbeat");
  queue.clear();
  await done;
  assert.deepEqual(sent, [100]);
  assert.deepEqual(succeeded, []);
});

test("a new connection can report after an aborted request", async () => {
  let first = true;
  const sent: number[] = [];
  const queue = new ReportQueue(async (presence, signal) => {
    sent.push(presence.observedAt);
    if (first) {
      first = false;
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
    return { changed: true };
  }, () => {}, (error) => { throw error; });
  const done = queue.enqueue(report(100), "presence");
  queue.clear();
  queue.enqueue(report(300), "new snapshot");
  await done;
  assert.deepEqual(sent, [100, 300]);
});

for (const packet of [
  { t: "GUILD_DELETE", d: { id: "456" } },
  { t: "GUILD_CREATE", d: { id: "456", unavailable: true } },
  { t: "GUILD_MEMBER_REMOVE", d: { guild_id: "456", user: { id: "123" } } },
]) {
  test(`${packet.t} revocation aborts HTTP and leaves no queued old heartbeat`, async () => {
    const sent: number[] = [];
    const queue = new ReportQueue(async (presence, signal) => {
      sent.push(presence.observedAt);
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return { changed: true };
    }, () => { throw new Error("cancelled reports must not succeed"); }, (error) => { throw error; });
    const state = new GatewayState("123", () => queue.clear());
    state.markReady();
    const first = state.accept({ t: "PRESENCE_UPDATE", d: { guild_id: "456", user: { id: "123" }, status: "online", activities: [] } }, 100);
    assert.ok(first);
    const done = queue.enqueue(first, "presence");
    const heartbeat = state.heartbeat(200);
    assert.ok(heartbeat);
    queue.enqueue(heartbeat, "heartbeat");
    state.accept(packet, 300);
    await done;
    assert.deepEqual(sent, [100]);
    assert.equal(state.heartbeat(400), null);
  });
}
