import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_WINDOW_MS, activeAgentIds, readActiveAgents, Schedule, waitForNextRound } from "../dist/cadence.js";

const NOW = 1_800_000_000_000;
const ACTIVE = 300_000;
const IDLE = 3_600_000;

const cadence = {
  activeIntervalMs: ACTIVE,
  idleIntervalMs: IDLE,
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

test("活动窗口内算在用，边界含在内；只读公开的活动接口", async () => {
  for (const [age, expected] of [
    [0, true], [ACTIVE_WINDOW_MS, true], [ACTIVE_WINDOW_MS + 1, false], [-60_000, true],
  ] as const) {
    const urls: string[] = [];
    const request: typeof fetch = async (url, init) => {
      urls.push(String(url));
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init?.headers, undefined);
      return Response.json(codingNow([{ id: "claude", at: [NOW - 86_400_000, NOW - age] }]));
    };
    assert.equal((await readActiveAgents(cadence, request, NOW)).has("claude"), expected);
    assert.deepEqual(urls, ["https://api.example/api/status/coding/now"]);
  }
});

test("按家判断在用：只看本上报器取限额的几家，任意来源在用都算", () => {
  const body = codingNow([
    { id: "pi", at: [NOW] },
    { id: "codex", at: [NOW - 3_600_000] },
    { id: "cursor", at: [NOW - 120_000, NOW - 7_200_000] },
    { id: "claude", at: [NOW - 7_200_000, NOW - 60_000] },
  ]);
  assert.deepEqual([...activeAgentIds(body, ["claude", "codex", "cursor"], NOW)].sort(), ["claude", "cursor"]);
  assert.deepEqual([...activeAgentIds(body, ["codex"], NOW)], []);
});

test("未配置不出网；接口异常或形状不对都当谁也没在用", async () => {
  let calls = 0;
  assert.equal((await readActiveAgents({ ...cadence, activityUrl: "" }, async () => {
    calls++;
    return Response.json(codingNow([{ id: "claude", at: [NOW] }]));
  }, NOW)).size, 0);
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
    assert.equal((await readActiveAgents(cadence, async () => fail(), NOW)).size, 0);
  }
});

const IDS = ["claude", "codex", "grok"] as const;

function schedule() {
  return new Schedule(IDS, { activeIntervalMs: ACTIVE, idleIntervalMs: IDLE });
}

test("启动时每家都到期；只有在用的那家按快档再取，其余等闲档", () => {
  const s = schedule();
  assert.deepEqual(s.due(0), [...IDS]);
  s.collected([...IDS], 0);
  s.observe(new Set(["claude"]));
  assert.deepEqual(s.due(ACTIVE * 0.9 - 1), []);
  assert.equal(s.delay(0), ACTIVE);
  assert.deepEqual(s.due(ACTIVE), ["claude"]);
  s.collected(["claude"], ACTIVE);
  assert.deepEqual(s.due(2 * ACTIVE), ["claude"]);
  assert.deepEqual(s.due(IDLE), ["claude", "codex", "grok"]);
});

test("闲着的那家开始用，下一轮提前到上次采集后一个快档；已过就立即到期", () => {
  const s = schedule();
  s.collected([...IDS], 0);
  s.observe(new Set());
  assert.equal(s.delay(0), IDLE);
  s.observe(new Set(["codex"]));
  assert.deepEqual(s.due(ACTIVE), ["codex"]);

  const late = schedule();
  late.collected([...IDS], 0);
  late.observe(new Set());
  late.observe(new Set(["grok"]));
  assert.deepEqual(late.due(1_000_000), ["grok"]);
  assert.equal(late.delay(1_000_000), 0);
});

test("差不到十分之一个快档就要到期的几家顺带进这一轮", () => {
  const s = schedule();
  s.collected(["codex", "grok"], 0);
  s.collected(["claude"], IDLE - ACTIVE - 1_000);
  s.observe(new Set(["claude"]));
  assert.deepEqual(s.due(IDLE - 20_000), ["claude", "codex", "grok"]);
  assert.deepEqual(s.due(IDLE - ACTIVE / 10 - 1), ["claude"]);
});

test("停用或活动接口读不到，不推迟已经排好的快档", () => {
  const s = schedule();
  s.collected([...IDS], 0);
  s.observe(new Set(["claude"]));
  s.observe(new Set());
  assert.deepEqual(s.due(ACTIVE), ["claude"]);
  s.collected(["claude"], ACTIVE);
  assert.deepEqual(s.due(2 * ACTIVE), []);
  assert.equal(s.delay(ACTIVE), IDLE - ACTIVE);
});

async function waitWith(s: InstanceType<typeof Schedule>, actives: string[][]) {
  let now = 0;
  let reads = 0;
  const naps: number[] = [];
  await waitForNextRound(s, ACTIVE, {
    readActive: async () => new Set(actives[Math.min(reads++, actives.length - 1)]),
    now: () => now,
    sleep: async ms => { naps.push(ms); now += ms; },
  });
  return { now, reads, naps };
}

test("闲档每 5 分钟重查活动，持续闲置仍每 60 分钟心跳", async () => {
  const s = schedule();
  s.collected([...IDS], 0);
  const idle = await waitWith(s, [[]]);
  assert.equal(idle.now, IDLE);
  assert.equal(idle.reads, 13);
  assert.ok(idle.naps.every(ms => ms === ACTIVE));
});

test("等待中某家开始用，过了快档就立即结束等待，只让那家到期", async () => {
  const s = schedule();
  s.collected([...IDS], 0);
  const result = await waitWith(s, [[], [], ["grok"]]);
  assert.equal(result.now, 2 * ACTIVE);
  assert.deepEqual(s.due(result.now), ["grok"]);
});

test("等待不足一个快档时按剩余时间睡", async () => {
  const s = new Schedule(IDS, { activeIntervalMs: ACTIVE, idleIntervalMs: 450_000 });
  s.collected([...IDS], 0);
  assert.deepEqual((await waitWith(s, [[]])).naps, [ACTIVE, 150_000]);
});
