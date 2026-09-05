import assert from "node:assert/strict";
import test from "node:test";
import { nextDelay, waitForNextRound } from "../dist/cadence.js";

const cadence = {
  liveIntervalMs: 300_000,
  openIntervalMs: 600_000,
  idleIntervalMs: 3_600_000,
  onlineCounterUrl: "https://online.example",
  livePushUrl: "https://push.example",
  countTimeoutMs: 2_500,
};

test("三档按可见、开着、无人选择；可见时不请求第二个计数口", async () => {
  for (const [online, connections, expected, calls] of [
    [1, 8, 300_000, 1], [0, 2, 600_000, 2], [0, 0, 3_600_000, 2],
  ]) {
    const urls: string[] = [];
    const request: typeof fetch = async (url, init) => {
      urls.push(String(url));
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init?.headers, undefined);
      return Response.json(String(url).includes("online.example") ? { online } : { connections });
    };
    assert.equal(await nextDelay(cadence, request), expected);
    assert.deepEqual(urls, ["https://online.example/count", "https://push.example/count"].slice(0, calls));
  }
});

test("未配置不出网；计数异常只向慢档退，另一计数口仍可选中档", async () => {
  let calls = 0;
  assert.equal(await nextDelay({ ...cadence, onlineCounterUrl: "", livePushUrl: "" }, async () => {
    calls++;
    return Response.json({ online: 0, connections: 0 });
  }), 3_600_000);
  assert.equal(calls, 0);

  const failures = [
    () => { throw new Error("network failure"); },
    () => { throw new DOMException("timeout", "TimeoutError"); },
    () => new Response("unavailable", { status: 503 }),
    () => new Response("not json"),
    ...[null, {}, { online: "1" }, { online: -1 }, { online: 0.5 }].map(body => () => Response.json(body)),
  ];
  for (const fail of failures) {
    const request: typeof fetch = async url => String(url).includes("online.example")
      ? fail()
      : Response.json({ connections: 1 });
    assert.equal(await nextDelay(cadence, request), 600_000);
    assert.equal(await nextDelay(cadence, async () => fail()), 3_600_000);
  }
});

async function waitWithDelays(delays: number[]) {
  let now = 0;
  let reads = 0;
  const naps: number[] = [];
  await waitForNextRound(300_000, {
    nextDelay: async () => delays[Math.min(reads++, delays.length - 1)]!,
    now: () => now,
    sleep: async ms => { naps.push(ms); now += ms; },
  });
  return { now, reads, naps };
}

test("闲档每 5 分钟重查；恢复可见或开着时立即提前采集", async () => {
  for (const faster of [300_000, 600_000]) {
    const result = await waitWithDelays([3_600_000, faster]);
    assert.equal(result.now, 300_000);
    assert.equal(result.reads, 2);
  }
  assert.equal((await waitWithDelays([600_000, 300_000])).now, 300_000);
});

test("持续无人仍每 60 分钟心跳；变慢不推迟已定轮次", async () => {
  const idle = await waitWithDelays([3_600_000]);
  assert.equal(idle.now, 3_600_000);
  assert.equal(idle.reads, 12);
  assert.ok(idle.naps.every(ms => ms === 300_000));
  assert.equal((await waitWithDelays([600_000, 3_600_000])).now, 600_000);
  assert.equal((await waitWithDelays([300_000])).reads, 1);
  assert.deepEqual((await waitWithDelays([450_000])).naps, [300_000, 150_000]);
});
