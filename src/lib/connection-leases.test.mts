import assert from "node:assert/strict";
import test from "node:test";

import { ConnectionLeases } from "./connection-leases.ts";

class FakeClient {
  disconnects = 0;

  disconnect() {
    this.disconnects += 1;
  }
}

test("同一 scope 内的顺序操作复用连接，scope 结束后才断开", async () => {
  const leases = new ConnectionLeases<FakeClient>();
  const clients: FakeClient[] = [];
  const acquire = () => leases.current() ?? leases.use(clients[clients.push(new FakeClient()) - 1]);

  await leases.scope(async () => {
    assert.equal(await leases.operation(acquire, async () => "first", "fallback"), "first");
    assert.equal(await leases.operation(acquire, async () => "second", "fallback"), "second");
    assert.equal(clients.length, 1);
    assert.equal(clients[0].disconnects, 0);
  });

  assert.equal(clients[0].disconnects, 1);
  assert.equal(leases.current(), null);
});

test("并发 scope 共享连接，最后一个 scope 结束后断开", async () => {
  const leases = new ConnectionLeases<FakeClient>();
  const client = new FakeClient();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
  const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve));

  const first = leases.scope(async () => {
    await leases.operation(() => leases.current() ?? leases.use(client), async () => undefined, undefined);
    await firstGate;
  });
  const second = leases.scope(async () => {
    await leases.operation(() => leases.current() ?? leases.use(client), async () => undefined, undefined);
    await secondGate;
  });

  releaseFirst();
  await first;
  assert.equal(client.disconnects, 0);

  releaseSecond();
  await second;
  assert.equal(client.disconnects, 1);
});

test("scope 外的单次操作结束后立即断开", async () => {
  const leases = new ConnectionLeases<FakeClient>();
  const client = new FakeClient();

  assert.equal(
    await leases.operation(() => leases.use(client), async () => 42, 0),
    42,
  );
  assert.equal(client.disconnects, 1);
  assert.equal(leases.current(), null);
});

test("并发 operation 到最后一条结束才断开", async () => {
  const leases = new ConnectionLeases<FakeClient>();
  const client = new FakeClient();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  const slow = leases.operation(
    () => leases.current() ?? leases.use(client),
    async () => gate,
    undefined,
  );
  await leases.operation(
    () => leases.current() ?? leases.use(client),
    async () => undefined,
    undefined,
  );
  assert.equal(client.disconnects, 0);

  release();
  await slow;
  assert.equal(client.disconnects, 1);
});

test("operation 抛错也会释放连接", async () => {
  const leases = new ConnectionLeases<FakeClient>();
  const client = new FakeClient();

  await assert.rejects(
    leases.operation(
      () => leases.use(client),
      async () => {
        throw new Error("boom");
      },
      undefined,
    ),
    /boom/,
  );
  assert.equal(client.disconnects, 1);
  assert.equal(leases.current(), null);
});

test("主动断开只作用于当前客户端", () => {
  const leases = new ConnectionLeases<FakeClient>();
  const current = leases.use(new FakeClient());
  const stale = new FakeClient();

  leases.disconnect(stale);
  assert.equal(stale.disconnects, 0);
  assert.equal(leases.current(), current);

  leases.disconnect(current);
  assert.equal(current.disconnects, 1);
  assert.equal(leases.current(), null);
});
