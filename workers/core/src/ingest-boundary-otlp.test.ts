import assert from "node:assert/strict";
import test from "node:test";

import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import { parseStoredCodingBuckets } from "@shared/coding-buckets";
import { cloudAgentActivity } from "@shared/pulse-coding";
import {
  codingActivityKey,
  codingBucketsKey,
  codingOtlpKey,
  codingUsageKey,
  codingViewKey,
  parseStoredActivity,
  parseStoredUsageLedgers,
  parseStoredView,
} from "@shared/coding-store";

import { type CollectedIngest } from "./ingest-effects";
import { prepareIngest as prepareShared, type CoreCommand } from "@shared/ingest/prepare";
import { type ImageBucket } from "@shared/ingest/r2-assets";
import { NOW, commit, fieldsOf, inRequest, testEnv, usageDay } from "./testing/ingest-harness";

function prepareIngest(source: string, body: unknown, at: number, images: ImageBucket = { head: async () => ({}) }): Promise<CoreCommand> {
  return prepareShared(source, body, at, images) as Promise<CoreCommand>;
}

function otlpTokens(at: number, value: number, type = "input", temporality = 2) {
  const time = `${BigInt(at) * BigInt(1_000_000)}`;
  const attributes = [
    ["session.id", "session-a"], ["user.email", "someone@example.com"], ["model", "claude-fable-5-1"], ["type", type],
  ].map(([key, entry]) => ({ key, value: { stringValue: entry } }));
  return {
    resourceMetrics: [{ scopeMetrics: [{ metrics: [
      { name: "claude_code.active_time.total", sum: { aggregationTemporality: 2, dataPoints: [] } },
      { name: "claude_code.token.usage", sum: { aggregationTemporality: temporality, dataPoints: [
        { attributes, startTimeUnixNano: "1", timeUnixNano: time, asDouble: value },
      ] } },
    ] }] }],
  };
}

test("agents-otlp turns cumulative deltas into day rows, token buckets and activity for claude", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const tagged = (result: CollectedIngest<unknown>) =>
    result.effects.some((effect) => effect.kind === "tags" && effect.tags.includes("coding"));
  const pushed = (result: CollectedIngest<unknown>) => result.effects.find((effect) => effect.kind === "event")?.event;
  try {
    const first = await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW, 100), NOW)));
    assert.equal(first.ok, true);
    assert.equal(tagged(first), true, "the first claude row is a skeleton change");
    assert.deepEqual(pushed(first)?.type === "coding-now" ? pushed(first)?.payload : null, {
      agents: [{ id: "claude", activity: [{ source: "agents-otlp", lastActivityAt: NOW, model: "claude-fable-5-1" }] }],
      lastSeenAt: 0, declaredOffline: false, heartbeatWindowMs: (pushed(first) as { payload: { heartbeatWindowMs: number } }).payload.heartbeatWindowMs,
    });

    const second = await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW + 60_000, 250), NOW + 60_000)));
    assert.equal(tagged(second), false, "more tokens on the same row are content, not layout");
    assert.equal(pushed(second)?.type, "coding-now");
    const idle = await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW + 120_000, 250), NOW + 120_000)));
    assert.equal(pushed(idle), undefined);

    const ledger = parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude;
    assert.equal(ledger?.days.reduce((sum, day) => sum + day.inputTokens, 0), 250);
    assert.equal(ledger?.days[0]?.costComplete, true);
    assert.equal(ledger?.sessionCount, 1);
    const buckets = parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents-otlp")));
    assert.deepEqual(buckets?.coverage, [], "OTLP is positive evidence only");
    assert.equal(buckets?.windows.flatMap((window) => window.agents).reduce((sum, row) => sum + row.inputTokens, 0), 250);
    assert.equal(buckets?.windows[0]?.agents[0]?.eventCount, null);
    const view = parseStoredView(await storage.get(codingViewKey()));
    assert.deepEqual(view?.agents.map((agent) => [agent.id, agent.sources]), [["claude", ["agents-otlp"]]]);
    assert.ok(!JSON.stringify([...Object.values(await fieldsOf(storage, codingUsageKey("agents-otlp"))), await storage.get(codingOtlpKey())]).includes("someone@example.com"));

    await assert.rejects(inRequest(env, () => prepareIngest("agents-otlp", { nope: true }, NOW)));
  } finally { installTestStorage(null); }
});

test("an OTLP commit that fails after the delta is computed writes nothing, so the next export still lands the whole delta", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const otlp = (at: number, input: number) => inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(at, input), at));
  const cloudInput = async () => parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude?.days
    .reduce((sum, day) => sum + day.inputTokens, 0);
  const bucketInput = async () => parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents-otlp")))?.windows
    .flatMap((window) => window.agents).reduce((sum, row) => sum + row.inputTokens, 0);
  try {
    storage.failWhen((commands) => commands.some((command) => command.op === "fields" && command.key === codingUsageKey("mac")));
    assert.equal((await commit(env, await otlp(NOW, 100))).ok, false);
    assert.equal(await storage.get(codingOtlpKey()), null, "the counter must not move ahead of its ledger");
    assert.deepEqual(await fieldsOf(storage, codingUsageKey("agents-otlp")), {});
    assert.equal(await storage.get(codingBucketsKey("agents-otlp")), null);

    storage.failWhen(null);
    assert.equal((await commit(env, await otlp(NOW + 60_000, 100))).ok, true);
    assert.equal(await cloudInput(), 100, "the delta that failed once is not lost");
    assert.equal(await bucketInput(), 100);

    const counters = await storage.get(codingOtlpKey());
    storage.failWhen((commands) => commands.some((command) => command.op === "set" && command.key === codingOtlpKey()));
    await commit(env, await otlp(NOW + 120_000, 180));
    storage.failWhen(null);
    assert.equal(await storage.get(codingOtlpKey()), counters);
    assert.equal(await cloudInput(), 100);
    assert.equal(await bucketInput(), 100);
    assert.equal((await commit(env, await otlp(NOW + 180_000, 180))).ok, true);
    assert.equal(await cloudInput(), 180);
    assert.equal(await bucketInput(), 180);
  } finally { storage.failWhen(null); installTestStorage(null); }
});

test("OTLP envelopes that commit in the opposite order of their receipt keep every delta in the ledger", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const ledger = async () => parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude!;
  const bucketTotal = async () => parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents-otlp")))?.windows
    .flatMap((window) => window.agents).reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
  try {
    const a = await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW, 100, "input"), NOW));
    const b = await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW + 1_000, 50, "output"), NOW + 1_000));
    assert.equal((await commit(env, b)).ok, true);
    assert.equal((await commit(env, a)).ok, true);
    assert.equal((await ledger()).days.reduce((sum, day) => sum + day.totalTokens, 0), 150, "A's delta is not dropped as a stale snapshot");
    assert.equal(await bucketTotal(), 150, "the ledger and the buckets agree");
    assert.equal((await ledger()).collectedAt, NOW + 1_000, "the collection time does not move back");
    assert.equal((await commit(env, a)).ok, true);
    assert.equal((await ledger()).days.reduce((sum, day) => sum + day.totalTokens, 0), 150);
    assert.equal(await bucketTotal(), 150);
  } finally { installTestStorage(null); }
});

test("delta-temporality OTLP points are not counted, so a retry after a lost receipt cannot double count", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const warnings: unknown[][] = [];
  const previous = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const delta = await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW, 100, "input", 1), NOW));
    assert.equal((await commit(env, delta)).ok, true);
    assert.equal((await commit(env, delta)).ok, true);
    const tokens = parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude?.days
      .reduce((sum, day) => sum + day.totalTokens, 0) ?? 0;
    assert.equal(tokens, 0, "delta points cannot be deduplicated, so none are counted (not 200)");
    assert.equal(await storage.get(codingBucketsKey("agents-otlp")), null);
    assert.ok(warnings.some((args) => String(args[0]).includes("delta temporality")), "a missing cumulative setting shows up as a warning");
    assert.equal((await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW + 60_000, 70), NOW + 60_000)))).ok, true);
    assert.equal(parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude?.days
      .reduce((sum, day) => sum + day.totalTokens, 0), 70);
  } finally { console.warn = previous; installTestStorage(null); }
});

// Devin CLI 只发 delta：每个窗口只带这段的增量，起点是上一次导出的时刻。
function devinTokens(from: number, to: number, values: Partial<Record<"input" | "output" | "cacheRead" | "cacheCreation", number>>, session = "lean-kayak") {
  const nanos = (at: number) => `${BigInt(at) * BigInt(1_000_000)}`;
  return {
    resourceMetrics: [{ scopeMetrics: [{ metrics: [
      { name: "devin.session.count", sum: { aggregationTemporality: 1, dataPoints: [] } },
      { name: "devin.token.usage", sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: Object.entries(values).map(([type, value]) => ({
        attributes: [["session.id", session], ["terminal.type", "devin-cli"], ["user.id", "user-x"], ["type", type], ["model", "swe-2-max"]]
          .map(([key, entry]) => ({ key, value: { stringValue: entry } })),
        startTimeUnixNano: nanos(from), timeUnixNano: nanos(to), asInt: value,
      })) } },
    ] }] }],
  };
}

test("Devin's delta windows are counted once each: a resent window is dropped, Claude's ledger and cloud activity stay apart", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const devin = async () => parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).devin!;
  const send = async (body: unknown, at: number) => commit(env, await inRequest(env, () => prepareIngest("agents-otlp", body, at)));
  try {
    const first = devinTokens(NOW - 1_000, NOW, { input: 10_787, output: 32, cacheRead: 10_176, cacheCreation: 0 });
    assert.equal((await send(first, NOW)).ok, true);
    assert.equal((await send(first, NOW + 5_000)).ok, true, "the exporter resends after a lost receipt");
    // 中间没用量的窗口不发，下一个窗口的起点晚于上一个的终点。
    assert.equal((await send(devinTokens(NOW + 4_000, NOW + 5_000, { input: 1_000, output: 8 }), NOW + 5_000)).ok, true);
    await send(otlpTokens(NOW + 6_000, 300), NOW + 6_000);
    await send(devinTokens(NOW + 6_000, NOW + 7_000, { output: 0 }, "session-a"), NOW + 7_000);

    const ledger = await devin();
    assert.equal(ledger.days.reduce((sum, day) => sum + day.totalTokens, 0), 10_787 + 32 + 10_176 + 1_008);
    assert.equal(ledger.days.at(-1)?.inputTokens, 11_787);
    assert.equal(ledger.days.at(-1)?.costComplete, false, "Devin sends no cost metric");
    assert.deepEqual(ledger.days.at(-1)?.models, [{ model: "swe-2-max", tokens: 22_003 }]);
    assert.equal(ledger.sessionCount, 2, "Devin's session-a is not Claude's session-a");
    const claude = parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude!;
    assert.equal(claude.days.reduce((sum, day) => sum + day.totalTokens, 0), 300);
    assert.equal(claude.sessionCount, 1, "sessions are counted per agent");

    const buckets = parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents-otlp")))!;
    const rows = buckets.windows.flatMap((window) => window.agents);
    assert.equal(rows.filter((row) => row.id === "devin").reduce((sum, row) => sum + row.inputTokens, 0), 11_787);
    assert.deepEqual(cloudAgentActivity({ ...buckets, windows: buckets.windows.map((window) => ({ ...window, agents: window.agents.filter((row) => row.id === "devin") })) }), [],
      "cloudActiveSeconds counts Claude's cloud threads only");

    const activity = parseStoredActivity(await storage.get(codingActivityKey("agents-otlp")))!;
    assert.deepEqual(activity.agents.map((agent) => [agent.id, agent.lastActivityAt]), [["claude", NOW + 6_000], ["devin", NOW + 5_000]]);
  } finally { installTestStorage(null); }
});

test("the first Devin OTLP batch takes over the tokens.ci day ledger from the account source and removes it there", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const history = { ...usageDay("2026-09-28", 5_000, "swe-2-max"), apiEquivalentCostUSD: 0, costComplete: false };
  try {
    const account = (at: number, agents: unknown[], extra: Record<string, unknown> = {}) => inRequest(env, () => prepareIngest("agents", {
      collectedAt: new Date(at).toISOString(), codingUsage: { agents }, ...extra,
    }, at));
    const bucketFrom = Math.floor((NOW - 600_000) / 300_000) * 300_000;
    const bucketRow = (id: string, inputTokens: number) => ({
      id, model: "m", inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: null,
    });
    const codingTokenBuckets = {
      from: bucketFrom, to: bucketFrom + 300_000, collectedAt: NOW - 120_000,
      agents: [{ id: "cursor", state: "ok" }, { id: "devin", state: "partial" }],
      windows: [{ from: bucketFrom, agents: [bucketRow("cursor", 70), bucketRow("devin", 900)] }],
    };
    assert.equal((await commit(env, await account(NOW - 120_000, [
      { id: "cursor", state: "ok", collectedAt: NOW - 120_000, sessionCount: null, days: [usageDay("2026-09-28", 700, "composer-2")] },
      { id: "devin", state: "ok", collectedAt: NOW - 120_000, sessionCount: null, days: [history] },
    ], { codingTokenBuckets }))).ok, true);
    assert.equal(parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents")))?.windows[0]?.agents.length, 2);
    assert.equal((await commit(env, await account(NOW - 60_000, [
      { id: "devin", state: "error", collectedAt: NOW - 120_000, sessionCount: null, error: "tokens.ci responded 503" },
    ]))).ok, true);
    const before = parseStoredView(await storage.get(codingViewKey()))!;
    assert.equal(before.totals?.totalTokens, 5_700);

    assert.equal((await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", devinTokens(NOW - 1_000, NOW, { input: 40 }), NOW)))).ok, true);

    const left = parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents")));
    assert.deepEqual(Object.keys(left), ["cursor"], "the account row would otherwise supersede the OTLP one");
    assert.equal(left.cursor?.days[0]?.totalTokens, 700);
    const accountBuckets = parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents")))!;
    assert.deepEqual(accountBuckets.windows.flatMap((window) => window.agents.map((row) => [row.id, row.inputTokens])), [["cursor", 70]],
      "the old spread-out Devin buckets would add to the OTLP ones in the Tokens lane");
    assert.deepEqual(accountBuckets.agents.map((agent) => agent.id), ["cursor"]);
    const moved = parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).devin!;
    assert.equal(moved.state, "ok");
    assert.equal(moved.error, null);
    assert.deepEqual(moved.days[0], history, "the old days are kept as they were");
    assert.equal(moved.days.reduce((sum, day) => sum + day.totalTokens, 0), 5_040);

    const view = parseStoredView(await storage.get(codingViewKey()))!;
    const row = view.agents.find((agent) => agent.id === "devin")!;
    assert.deepEqual(row.sources, ["agents-otlp"]);
    assert.deepEqual(row.status.map((status) => [status.source, status.state]), [["agents-otlp", "ok"]]);
    assert.equal(view.totals?.totalTokens, 5_740);

    // 旧镜像的 agents-reporter 还在跑：它的 devin 行又回来时，下一封 OTLP 照样把它删掉，日子不再接一遍。
    await commit(env, await account(NOW + 60_000, [
      { id: "devin", state: "ok", collectedAt: NOW + 60_000, sessionCount: null, days: [history, usageDay("2026-09-29", 9_999, "swe-2-max")] },
    ]));
    assert.deepEqual(parseStoredView(await storage.get(codingViewKey()))!.agents.find((agent) => agent.id === "devin")!.sources, ["agents"]);
    await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", devinTokens(NOW + 61_000, NOW + 62_000, { input: 2 }), NOW + 62_000)));
    assert.deepEqual(Object.keys(parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents")))), ["cursor"]);
    const after = parseStoredView(await storage.get(codingViewKey()))!;
    assert.deepEqual(after.agents.find((agent) => agent.id === "devin")!.sources, ["agents-otlp"]);
    assert.equal(after.totals?.totalTokens, 5_742);
  } finally { installTestStorage(null); }
});

test("the Mac's Devin OTLP moves to mac-otlp once with its days, sessions, activity and buckets; later agents-otlp Devin is the cloud's", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const send = async (source: "agents-otlp" | "mac-otlp", body: unknown, at: number) => commit(env, await inRequest(env, () => prepareIngest(source, body, at)));
  const ledger = async (source: "agents-otlp" | "mac-otlp") => parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey(source))).devin;
  const devinRows = async (source: "agents-otlp" | "mac-otlp") => (parseStoredCodingBuckets(await storage.get(codingBucketsKey(source)))?.windows ?? [])
    .flatMap((window) => window.agents.filter((row) => row.id === "devin").map((row) => row.inputTokens));
  try {
    assert.equal((await send("agents-otlp", devinTokens(NOW - 1_000, NOW, { input: 500 }, "mac-1"), NOW)).ok, true);
    assert.equal((await send("agents-otlp", devinTokens(NOW + 1_000, NOW + 2_000, { input: 70 }), NOW + 2_000)).ok, true);
    assert.equal((await send("agents-otlp", otlpTokens(NOW + 2_000, 300), NOW + 2_000)).ok, true);

    assert.equal((await send("mac-otlp", devinTokens(NOW + 3_000, NOW + 4_000, { input: 5 }, "mac-1"), NOW + 4_000)).ok, true);
    assert.equal((await send("mac-otlp", devinTokens(NOW - 1_000, NOW, { input: 500 }, "mac-1"), NOW + 4_500)).ok, true,
      "the exporter resends a window the old source already counted");
    const mac = (await ledger("mac-otlp"))!;
    assert.equal(mac.days.reduce((sum, day) => sum + day.totalTokens, 0), 575);
    // 会话摘要不分 agent、搬不走：搬家前见过的会话在新来源再记一次，只多这一回。
    assert.equal(mac.sessionCount, 3, "the moved session count is kept");
    assert.equal(await ledger("agents-otlp"), undefined);
    assert.deepEqual(await devinRows("agents-otlp"), []);
    assert.equal((await devinRows("mac-otlp")).reduce((sum, value) => sum + value, 0), 575);
    const cloudActivity = parseStoredActivity(await storage.get(codingActivityKey("agents-otlp")))!;
    assert.deepEqual(cloudActivity.agents.map((agent) => agent.id), ["claude"]);
    const macActivity = parseStoredActivity(await storage.get(codingActivityKey("mac-otlp")))!;
    assert.deepEqual(macActivity.agents.map((agent) => [agent.id, agent.lastActivityAt]), [["devin", NOW + 4_000]]);

    assert.equal((await send("agents-otlp", devinTokens(NOW + 5_000, NOW + 6_000, { input: 9 }, "cloud-1"), NOW + 6_000)).ok, true);
    const cloud = (await ledger("agents-otlp"))!;
    assert.equal(cloud.days.reduce((sum, day) => sum + day.totalTokens, 0), 9, "the cloud starts its own ledger");
    assert.equal(cloud.sessionCount, 1, "the Mac's sessions went with its ledger");
    assert.equal((await ledger("mac-otlp"))!.days.reduce((sum, day) => sum + day.totalTokens, 0), 575, "moved only once");

    const view = parseStoredView(await storage.get(codingViewKey()))!;
    const row = view.agents.find((agent) => agent.id === "devin")!;
    assert.deepEqual(row.sources, ["agents-otlp", "mac-otlp"]);
    assert.equal(view.agents.find((agent) => agent.id === "claude")!.sources.join(), "agents-otlp");
  } finally { installTestStorage(null); }
});
