#!/usr/bin/env node
/** Local, isolated end-to-end verification. Never reads .env or ambient production credentials. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { devAccessFromEnv } from "./dev-access.mjs";

const { values } = parseArgs({ options: {
  ingest: { type: "string", default: "http://127.0.0.1:8787" },
  base: { type: "string", default: "http://localhost:3211" },
  "storage-prefix": { type: "string" },
  snapshot: { type: "string" },
  help: { type: "boolean" },
} });
if (values.help) {
  console.log("node scripts/verify-coding-usage.mjs --storage-prefix <isolated-dev-prefix> [--snapshot <Hub codingUsage report JSON>] [--base http://localhost:3211] [--ingest http://127.0.0.1:8787]");
  console.log("Requires dedicated local Next and Worker servers with the same empty isolated Durable Object, with the local Access test key (LOCAL_ACCESS_PRIVATE_JWK, see scripts/dev-access.mjs); production services must not be configured. Leaves the synthetic facts (and the optional Hub report) installed.");
  process.exit(0);
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
function localURL(value, protocol) {
  const url = new URL(value);
  assert.equal(url.protocol, protocol, `Only ${protocol} is allowed`);
  assert.ok(localHosts.has(url.hostname), "Only literal localhost targets are allowed");
  assert.ok(!url.username && !url.password && !url.search && !url.hash, "Credentials, query and fragment are forbidden in target URLs");
  return url;
}
const base = localURL(values.base, "http:");
assert.equal(base.pathname, "/", "The HTTP target must be an origin");
const ingest = localURL(values.ingest, "http:");
assert.equal(ingest.pathname, "/");
const prefix = values["storage-prefix"];
assert.ok(prefix && /^[a-zA-Z0-9:_-]+$/.test(prefix) && /(?:^|[-_:])(test|dev|verify)(?:[-_:]|$)/.test(prefix), "Supply an explicit test/dev/verify storage prefix; production prefixes are forbidden");

// 父进程（verify-api-worker.mjs）把它那把测试钥匙经 LOCAL_ACCESS_PRIVATE_JWK 传下来
const access = await devAccessFromEnv();
assert.ok(access, "LOCAL_ACCESS_PRIVATE_JWK is required: run through scripts/verify-api-worker.mjs, or export the key from scripts/dev-access.mjs");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const MINUTE = 60_000;
const BUCKET = 5 * MINUTE;
/** Asia/Shanghai 站点日 */
const siteDay = (stamp) => new Date(stamp + 8 * 3_600_000).toISOString().slice(0, 10);

const now = Date.now();
const today = siteDay(now);
const yesterday = siteDay(now - 86_400_000);
function day(date, tokens, model, extra = {}) {
  return {
    date, inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    totalTokens: tokens, apiEquivalentCostUSD: tokens / 1_000, costComplete: true, models: model ? [{ model, tokens }] : [], ...extra,
  };
}
const macUsage = (at, claudeToday = 2_000) => ({ agents: [
  { id: "claude", state: "ok", collectedAt: at, sessionCount: 4, days: [day(yesterday, 1_000, "claude-opus-5"), day(today, claudeToday, "claude-opus-5")] },
  { id: "codex", state: "ok", collectedAt: at, sessionCount: 2, days: [day(today, 0, null)] },
  { id: "grok", state: "error", collectedAt: null, error: "Verification: ccusage unavailable" },
  // Mac 就算又报了 cursor，也被账号级来源盖住
  { id: "cursor", state: "ok", collectedAt: at, days: [day(today, 99_999, "composer-1")] },
] });
const macActivity = (at) => ({ collectedAt: at, agents: [{ id: "claude", lastActivityAt: at - 20_000, model: "claude-opus-5" }, { id: "codex", lastActivityAt: null, model: null }] });
const bucketFrom = Math.floor((now - 20 * MINUTE) / BUCKET) * BUCKET;
const macBuckets = (at) => ({
  from: bucketFrom, to: at, collectedAt: at, agents: [{ id: "claude", state: "ok" }, { id: "codex", state: "ok" }],
  windows: [{ from: bucketFrom + BUCKET, agents: [{ id: "claude", model: "claude-opus-5", inputTokens: 6_000, outputTokens: 400, cacheReadTokens: 50_000, cacheCreationTokens: 100, reasoningTokens: 0, eventCount: 3 }] }],
});
const cursorUsage = (at) => ({ agents: [{ id: "cursor", state: "ok", collectedAt: at, sessionCount: null, days: [day(yesterday, 500, "composer-2")] }] });
const limits = { agents: [
  { id: "claude", plan: { tier: "max", label: "Verification Max" }, limits: [{ key: "claude.primary", usedPercent: 20, windowMinutes: 300 }], limitsError: null },
  { id: "limits-only-demo", plan: null, limits: [], limitsError: "Verification: limits unavailable" },
] };

function envelope(modules, activeModules = ["coding"]) {
  return { version: 4, heartbeatAt: Date.now(), presence: "online", activeModules, modules };
}
function otlp(at, value) {
  const attributes = (type) => [["session.id", "verify-session"], ["model", "claude-fable-5"], ["type", type]]
    .map(([key, stringValue]) => ({ key, value: { stringValue } }));
  return { resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: "claude_code.token.usage", sum: { aggregationTemporality: 2, dataPoints: [
    { attributes: attributes("input"), startTimeUnixNano: "1", timeUnixNano: `${BigInt(at) * 1_000_000n}`, asDouble: value },
  ] } }] }] }] };
}
// authorization：默认带 Access JWT；null 不带任何凭据；字符串按旧式 Bearer 发（应当被拒）
async function request(path, body, authorization = "access") {
  const auth = authorization === "access" ? await access.headers() : authorization ? { authorization: `Bearer ${authorization}` } : {};
  const response = await fetch(new URL(path, ingest), {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() };
}
async function post(path, body, status = 202, authorization = "access") {
  const result = await request(path, body, authorization);
  assert.equal(result.status, status, `${path}: ${JSON.stringify(result.body)}`);
  // OTLP exporter 的成功回执是空对象，没有 ok
  if (path !== "/api/ingest/agents/otlp") assert.equal(result.body.ok, status === 202);
  return result.body;
}
async function eventually(check, label) {
  const deadline = Date.now() + 30_000;
  let last;
  do {
    try { return await check(); } catch (error) { last = error; }
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error(`${label} did not converge: ${last?.message}`, { cause: last });
}
async function data(path) {
  const result = await request(path);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true, JSON.stringify(result.body));
  return result.body.data;
}
const agentOf = (usage, id) => usage.agents.find((agent) => agent.id === id);

let passed = 0;
function pass(label) { console.log(`PASS ${++passed}: ${label}`); }

await post("/api/ingest/mac", envelope({ codingUsage: macUsage(now) }), 401, null);
await post("/api/ingest/agents", limits, 401, "wrong-verification-secret");
pass("Both ingest endpoints enforce authentication");
assert.equal((await request("/api/status/coding")).body.ok, false, "Use a fresh isolated Worker; existing coding data must not be overwritten");

await post("/api/ingest/agents", limits);
await eventually(async () => {
  const stored = await data("/api/status/limits");
  assert.deepEqual(Object.keys(stored.agents).sort(), limits.agents.map(({ id }) => id).sort());
  assert.equal((await request("/api/status/coding")).body.ok, false, "Limits live in the lag layer, not in the usage view");
}, "limits-only state");
pass("Limits land in the lag layer; the usage view stays empty until usage arrives");

const broken = macUsage(now);
broken.agents[0].days[1].totalTokens = 1;
const receipt = await post("/api/ingest/mac", envelope({ codingUsage: broken, codingActivity: macActivity(now), vibeCodingNow: { agents: [] } }));
assert.deepEqual(receipt.data.ignored, ["vibeCodingNow"]);
assert.deepEqual(receipt.data.rejected.map(({ module }) => module), ["codingUsage"]);
assert.match(receipt.data.rejected[0].error, /agents\[0\]\.days\[1\]\.totalTokens/);
await eventually(async () => {
  const live = await data("/api/status/coding/now");
  assert.deepEqual(live.agents, [{ id: "claude", activity: [{ source: "mac", lastActivityAt: now - 20_000, model: "claude-opus-5" }] }]);
  assert.equal(live.declaredOffline, false);
  assert.equal((await request("/api/status/coding")).body.ok, false, "the rejected usage never landed");
}, "partial Mac envelope");
pass("A broken coding module is dropped alone: the receipt names it, the renamed module is ignored, activity still lands");

await post("/api/ingest/mac", envelope({ codingUsage: macUsage(now), codingTokenBuckets: macBuckets(now) }));
await post("/api/ingest/agents", { collectedAt: new Date(now).toISOString(), codingUsage: cursorUsage(now) });
const first = await eventually(async () => {
  const usage = await data("/api/status/coding");
  assert.equal(usage.totals.totalTokens, 3_500);
  assert.equal(usage.totals.activeDays, 2);
  assert.equal(usage.totals.sessionCount, 6);
  assert.deepEqual(usage.topModels, [{ model: "claude-opus-5", tokens: 3_000 }, { model: "composer-2", tokens: 500 }]);
  assert.deepEqual(agentOf(usage, "cursor").sources, ["agents"]);
  assert.deepEqual(agentOf(usage, "cursor").status.map(({ source, state }) => [source, state]), [["mac", "superseded"], ["agents", "ok"]]);
  assert.equal(agentOf(usage, "codex").lastDay.totalTokens, 0, "a confirmed zero today, not unknown");
  assert.equal(agentOf(usage, "grok").lastDay, null);
  assert.equal(agentOf(usage, "grok").status[0].state, "error");
  return usage;
}, "Mac and Cursor usage view");
pass("Usage view: Mac ledgers plus the Cursor account ledger; the Mac's own cursor row is superseded, zero and unknown stay distinct");

await post("/api/ingest/agents/otlp", otlp(now, 300), 200);
await post("/api/ingest/agents/otlp", otlp(now + 1_000, 450), 200);
const cloud = await eventually(async () => {
  const usage = await data("/api/status/coding");
  assert.deepEqual(agentOf(usage, "claude").sources, ["mac", "agents-otlp"]);
  assert.equal(usage.totals.totalTokens, 3_950, "cumulative 450 counted once");
  assert.equal(agentOf(usage, "claude").lastDay.totalTokens, 2_450);
  return usage;
}, "cloud usage");
assert.ok(cloud.updatedAt >= first.updatedAt);
const live = await data("/api/status/coding/now");
assert.deepEqual(live.agents.find(({ id }) => id === "claude").activity.map(({ source }) => source).sort(), ["agents-otlp", "mac"]);
pass("Claude Code cloud telemetry adds only its deltas; claude sums the Mac and cloud sources, and now shows both");

await post("/api/ingest/mac", envelope({ codingUsage: macUsage(now) }));
await sleep(300);
assert.equal((await data("/api/status/coding")).totals.totalTokens, 3_950);
pass("Repeated ledgers replace instead of accumulating twice");

const year = await data("/api/status/coding/year");
assert.equal(year.days.length, 371);
assert.equal(year.todayAtSource, today);
const offset = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${year.origin}T00:00:00Z`)) / 86_400_000);
assert.equal(year.days[offset(today)], 2_450);
assert.equal(year.days[offset(yesterday)], 1_500);
assert.deepEqual(year.mix.find((row) => row[0] === offset(yesterday)).slice(1).map((value, index) => index % 2 ? value : year.models[value]), ["claude-opus-5", 1_000, "composer-2", 500]);
pass("Year: 371 days from the Sunday 52 weeks back, exact per-day model split across sources");

const pulse = await data("/api/status/pulse");
const lane = pulse.lanes.tokens;
assert.equal(lane.kind, "tokens");
assert.ok(lane.buckets.fresh.some((value) => value >= 6_500), JSON.stringify(lane));
assert.ok(lane.summary.freshTokens >= 6_500);
assert.equal(JSON.stringify(lane).includes("claude"), false);
pass("Pulse Tokens lane sums the token buckets without model or source names");

const failed = macUsage(now + 1_000);
failed.agents = [{ id: "claude", state: "error", collectedAt: now, error: "Verification: scan failed" }];
await post("/api/ingest/mac", envelope({ codingUsage: failed }));
await eventually(async () => {
  const usage = await data("/api/status/coding");
  assert.deepEqual(agentOf(usage, "claude").status.map(({ source, state }) => [source, state]), [["mac", "error"], ["agents-otlp", "ok"]]);
  assert.equal(usage.totals.totalTokens, 3_950, "a failed round keeps the history");
}, "error round");
pass("A failed collection round only changes the status; the stored days stay");

if (values.snapshot) {
  const snapshot = JSON.parse(await readFile(values.snapshot, "utf8"));
  const modules = snapshot.agents ? { codingUsage: snapshot } : snapshot;
  const answer = await post("/api/ingest/mac", envelope(modules));
  assert.deepEqual(answer.data.rejected, [], JSON.stringify(answer.data.rejected));
  console.log(`INSTALLED ${values.snapshot}`);
}
console.log(`All ${passed} end-to-end checks passed at ${base.origin}, storage prefix ${prefix}.`);
