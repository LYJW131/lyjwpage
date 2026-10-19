import assert from "node:assert/strict";
import test from "node:test";

import { SERVER_TAG } from "@shared/live-events";
import { CREDENTIAL_KEYS } from "@shared/credentials";
import { LAG_KEYS, readLag } from "@shared/lag";

import { json, mac, post, server, workout, world } from "./testing/world";

test("split: server reports bypass the state core and land in the lag layer, the archive and the ledger", async () => {
  const w = world();
  const reporter = { commit: "abc1234", pushes: 3, rttMs: 120, start: Date.now() - 3_600_000, end: Date.now() };
  const response = await w.send("/api/ingest/server", post({ ...server(), reporter }));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), { ok: true, data: { id: "misaka-jp" } });
  assert.equal(w.calls.commits.length, 0);
  assert.equal(w.calls.ready, 0);
  assert.equal((await readLag<{ id: string }>(w.lag, LAG_KEYS.server))?.data.id, "misaka-jp");
  assert.equal((await readLag<{ commit: string }>(w.lag, LAG_KEYS.reporterServer))?.data.commit, "abc1234");
  assert.equal(w.calls.archived.length, 1, "server hours go to D1");
  assert.deepEqual(w.calls.revalidated, [[SERVER_TAG]]);
});

test("split: an iPhone report with accepted workouts and rejected rings writes the accepted half, then answers 400", async () => {
  const w = world({ reply: (command) => {
    assert.equal(command.source === "iphone" && command.failure?.stage, "beforeActivity");
    return { ready: true, ok: false, error: "活动上报的 date 必须是 YYYY-MM-DD" };
  } });
  const response = await w.send("/api/ingest/iphone", post({ version: 1, modules: { workouts: { items: [workout()] }, activity: { date: "bad" } } }));
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { ok: false, error: "上报数据无效或处理失败" });
  assert.equal(w.calls.commits.length, 1);
  assert.equal((await readLag<{ items: { id: string }[] }>(w.lag, LAG_KEYS.workouts))?.data.items[0]?.id, workout().id);
  assert.equal(await readLag(w.lag, LAG_KEYS.activity), null);
  assert.equal(w.calls.archived.length, 1, "the accepted workouts are archived too");

  const focus = world({ reply: (command) => {
    assert.equal(command.source === "iphone" && command.failure?.stage, "beforeFocus");
    return { ready: true, ok: false, error: "专注模式上报的 mode 必须是字符串" };
  } });
  assert.equal((await focus.send("/api/ingest/iphone", post({ version: 1, modules: { workouts: { items: [workout()] }, focus: { mode: 3 } } }))).status, 400);
  assert.equal((await readLag<{ items: { id: string }[] }>(focus.lag, LAG_KEYS.workouts))?.data.items[0]?.id, workout().id, "a bad focus module keeps the accepted workouts");
  assert.equal(focus.calls.archived.length, 1);

  const early = world({ reply: () => ({ ready: true, ok: false, error: "Invalid workout identity or activityType" }) });
  assert.equal((await early.send("/api/ingest/iphone", post({ version: 1, modules: { workouts: { items: [workout({ id: "bad" })] } } }))).status, 400);
  assert.equal(early.lag.writes, 0);
  assert.equal(early.calls.archived.length, 0);
});

test("split: Mac credentials and timezone go to their KV namespaces only after the state core accepted", async () => {
  const w = world();
  const response = await w.send("/api/ingest/mac", post(mac({
    timezone: { identifier: "Asia/Tokyo", abbreviation: "JST", secondsFromGMT: 32400 },
    appleMusicCredentials: { musicUserToken: " user-token " },
  })));
  assert.equal(response.status, 202);
  const [command] = w.calls.commits;
  assert.equal(command?.source, "mac");
  const stored = JSON.parse(w.credentials.values.get(CREDENTIAL_KEYS.appleMusic) ?? "null") as { musicUserToken: string; receivedAt: number };
  assert.equal(stored.musicUserToken, "user-token");
  assert.equal(stored.receivedAt, command?.receivedAt);
  assert.equal((await readLag<{ timezone: { identifier: string } }>(w.lag, LAG_KEYS.timezone))?.data.timezone.identifier, "Asia/Tokyo");
  assert.deepEqual(w.calls.revalidated, [], "a timezone change is content, not layout");
});

test("split: agents limits land in the lag layer while the coding half still reaches the state core", async () => {
  const w = world();
  const response = await w.send("/api/ingest/agents", post({
    agents: [{ id: "codex", plan: { tier: "pro" }, limits: [{ key: "codex.primary", usedPercent: 20, windowMinutes: 300 }], limitsError: null }],
    collectedAt: new Date().toISOString(),
    codingActivity: { collectedAt: Date.now(), agents: [{ id: "cursor", lastActivityAt: Date.now() - 5_000, model: "composer-2" }] },
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), { ok: true, data: { accepted: 1, rejected: [] } });
  const [command] = w.calls.commits;
  assert.equal(command?.source === "agents" ? command.codingActivity?.agents[0]?.id : null, "cursor");
  assert.ok((await readLag<{ agents: Record<string, unknown> }>(w.lag, LAG_KEYS.limits))?.data.agents.codex);
  assert.equal(w.calls.archived.length, 1, "limit snapshots are archived");
});
