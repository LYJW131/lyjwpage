import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_WINDOW_MS, latestActivityAt, nextDelay, waitForNextRound } from "../dist/cadence.js";

const NOW = 1_800_000_000_000;

const cadence = {
  activeIntervalMs: 300_000,
  idleIntervalMs: 3_600_000,
  activityUrl: "https://api.example/api/status/coding/now",
  activityTimeoutMs: 2_500,
};

function codingNow(agents: Array<{ id: string; at: number[] }>) {
  return {
    ok: true,
    data: {
      agents: agents.map(({ id, at }) => ({
        id,
        activity: at.map(lastActivityAt => ({ source: "mac", lastActivityAt, model: null })),
      })),
    },
  };
}

test("限额对应的 agent 最近在用走快档，久未使用走闲档；只读公开的活动接口", async () => {
  for (const [age, expected] of [
    [0, 300_000], [ACTIVE_WINDOW_MS, 300_000], [ACTIVE_WINDOW_MS + 1, 3_600_000], [-60_000, 300_000],
  ]) {
    const urls: string[] = [];
    const request: typeof fetch = async (url, init) => {
      urls.push(String(url));
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init?.headers, undefined);
      return Response.json(codingNow([{ id: "claude", at: [NOW - 86_400_000, NOW - age] }]));
    };
    assert.equal(await nextDelay(cadence, request, NOW), expected);
    assert.deepEqual(urls, ["https://api.example/api/status/coding/now"]);
  }
});

test("只看本上报器取限额的 agent，任意一家、任意来源在用都算", () => {
  const body = codingNow([
    { id: "pi", at: [NOW] },
    { id: "codex", at: [NOW - 3_600_000] },
    { id: "cursor", at: [NOW - 120_000, NOW - 7_200_000] },
  ]);
  assert.equal(latestActivityAt(body, ["claude", "codex", "cursor"]), NOW - 120_000);
  assert.equal(latestActivityAt(body, ["claude"]), null);
});

test("未配置不出网；接口异常或形状不对都只向闲档退", async () => {
  let calls = 0;
  assert.equal(await nextDelay({ ...cadence, activityUrl: "" }, async () => {
    calls++;
    return Response.json(codingNow([{ id: "claude", at: [NOW] }]));
  }, NOW), 3_600_000);
  assert.equal(calls, 0);

  const failures = [
    () => { throw new Error("network failure"); },
    () => { throw new DOMException("timeout", "TimeoutError"); },
    () => new Response("unavailable", { status: 503 }),
    () => new Response("not json"),
    ...[
      null, {}, { ok: false }, { ok: true, data: { agents: {} } },
      { ok: true, data: { agents: [{ id: "claude", activity: [{ lastActivityAt: String(NOW) }] }] } },
      { ok: true, data: { agents: [null, { id: 1, activity: [] }, { id: "claude", activity: null }] } },
    ].map(body => () => Response.json(body)),
  ];
  for (const fail of failures) {
    assert.equal(await nextDelay(cadence, async () => fail(), NOW), 3_600_000);
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

test("闲档每 5 分钟重查；开始使用时立即提前采集", async () => {
  const result = await waitWithDelays([3_600_000, 300_000]);
  assert.equal(result.now, 300_000);
  assert.equal(result.reads, 2);
});

test("持续闲置仍每 60 分钟心跳；变慢不推迟已定轮次", async () => {
  const idle = await waitWithDelays([3_600_000]);
  assert.equal(idle.now, 3_600_000);
  assert.equal(idle.reads, 12);
  assert.ok(idle.naps.every(ms => ms === 300_000));
  assert.equal((await waitWithDelays([300_000, 3_600_000])).now, 300_000);
  assert.equal((await waitWithDelays([300_000])).reads, 1);
  assert.deepEqual((await waitWithDelays([450_000])).naps, [300_000, 150_000]);
});
