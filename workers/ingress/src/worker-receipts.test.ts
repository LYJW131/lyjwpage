import assert from "node:assert/strict";
import test from "node:test";

import { LAG_KEYS, readLag } from "@shared/lag";

import { codingUsage, json, mac, post, world } from "./testing/world";

test("receipts: 202 carries the state core's data; invalid input is a 400 without asking for readiness", async () => {
  const w = world({ reply: () => ({ ready: true, ok: true, data: { accepted: 0, heartbeat: true } }) });
  const accepted = await w.send("/api/ingest/mac", post(mac({})));
  assert.equal(accepted.status, 202);
  assert.deepEqual(await json(accepted), { ok: true, data: { accepted: 0, heartbeat: true, ignored: [], rejected: [] } });
  assert.equal(accepted.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(accepted.headers.get("cache-control"), "no-store");

  const invalidJson = await w.send("/api/ingest/mac", { body: '{"private-marker":' });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await json(invalidJson), { ok: false, error: "上报数据无效或处理失败" });
  const invalid = await w.send("/api/ingest/mac", post({}));
  assert.equal(invalid.status, 400);
  assert.equal(w.calls.ready, 0, "ingress never asks the state core for readiness");

  const notReady = world({ reply: () => ({ ready: false, ok: false }) });
  const late = await notReady.send("/api/ingest/iphone", post({ version: 1 }));
  assert.equal(late.status, 503);
  assert.deepEqual(await json(late), { ok: false, error: "状态存储暂时不可用，请重试" });

  const rejected = world({ reply: () => ({ ready: true, ok: false, error: "desktop 模块缺少 applicationName" }) });
  const rejection = await rejected.send("/api/ingest/mac", post(mac({ timezone: { identifier: "Asia/Tokyo", secondsFromGMT: 32400 } })));
  assert.equal(rejection.status, 400);
  assert.deepEqual(await json(rejection), { ok: false, error: "上报数据无效或处理失败" });
  assert.equal(rejected.lag.writes, 0, "a report the state core rejected leaves the lag layer alone");

  const broken = world({ reply: () => { throw new Error("RPC reset"); } });
  assert.equal((await broken.send("/api/ingest/homepod", post({ state: "playing", title: "x" }))).status, 400);

  const transient = world({ reply: () => ({ ready: true, ok: false, error: "Durable Object reset because its code was updated.", retryable: true }) });
  const retryLater = await transient.send("/api/ingest/homepod", post({ state: "playing", title: "x" }));
  assert.equal(retryLater.status, 503, "a transient state core failure must not look like a bad report");
  assert.deepEqual(await json(retryLater), { ok: false, error: "状态存储暂时不可用，请重试" });
  assert.equal(transient.lag.writes, 0);
  assert.equal(transient.calls.archived.length, 0);

  const severed = world({ reply: () => { throw Object.assign(new Error("Network connection lost."), { retryable: true }); } });
  assert.equal((await severed.send("/api/ingest/homepod", post({ state: "playing", title: "x" }))).status, 503);
});

test("receipts: a broken coding module is dropped alone — 202 names it, logs a warning, and the rest of the Mac envelope still commits", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const w = world({ reply: () => ({ ready: true, ok: true, data: { accepted: 2, heartbeat: true } }) });
  const response = await w.send("/api/ingest/mac", post(mac({
    desktop: { applicationName: "Xcode", bundleIdentifier: "com.apple.dt.Xcode", windowTitle: "App.swift" },
    timezone: { identifier: "Asia/Tokyo", abbreviation: "JST", secondsFromGMT: 32400 },
    codingUsage: codingUsage(3),
  })));
  assert.equal(response.status, 202);
  const error = "agents[0].days[0].totalTokens 小于四列之和";
  assert.deepEqual(await json(response), {
    ok: true,
    data: { accepted: 2, heartbeat: true, ignored: [], rejected: [{ module: "codingUsage", error }] },
  });
  const [command] = w.calls.commits;
  assert.equal(command?.source === "mac" ? command.modules.desktop?.activity?.applicationName : null, "Xcode");
  assert.equal(command?.source === "mac" && "codingUsage" in command.modules, false);
  assert.equal((await readLag<{ timezone: { identifier: string } }>(w.lag, LAG_KEYS.timezone))?.data.timezone.identifier, "Asia/Tokyo");
  assert.deepEqual(warned.mock.calls.map((call) => call.arguments), [["[ingest] rejected", "mac", `codingUsage：${error}`]]);
});

test("receipts: modules the ingress does not know (including the renamed vibeCoding*) are echoed back as ignored", async () => {
  const w = world({ reply: () => ({ ready: true, ok: true, data: { accepted: 1, heartbeat: true } }) });
  const response = await w.send("/api/ingest/mac", post(mac({
    vibeCodingNow: { agents: [] },
    codingUsage: codingUsage(10),
  })));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), {
    ok: true,
    data: { accepted: 1, heartbeat: true, ignored: ["vibeCodingNow"], rejected: [] },
  });
  const [command] = w.calls.commits;
  assert.deepEqual(command?.source === "mac" ? Object.keys(command.modules) : null, ["codingUsage"]);
});

test("receipts: agents limits still land when only its coding data is broken; nothing usable left is a 400", async (t) => {
  t.mock.method(console, "warn", () => {});
  const errors = t.mock.method(console, "error", () => {});
  const w = world();
  const response = await w.send("/api/ingest/agents", post({
    agents: [{ id: "cursor", plan: { tier: "ultra" }, limits: [] }],
    collectedAt: new Date().toISOString(),
    codingUsage: codingUsage(3),
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), {
    ok: true,
    data: { accepted: 1, rejected: [{ module: "codingUsage", error: "agents[0].days[0].totalTokens 小于四列之和" }] },
  });
  assert.ok((await readLag<{ agents: Record<string, unknown> }>(w.lag, LAG_KEYS.limits))?.data.agents.cursor);

  const empty = world();
  const refused = await empty.send("/api/ingest/agents", post({ collectedAt: new Date().toISOString(), codingUsage: codingUsage(3) }));
  assert.equal(refused.status, 400);
  assert.deepEqual(await json(refused), { ok: false, error: "上报数据无效或处理失败" });
  assert.equal(empty.calls.commits.length, 0);
  assert.match(String(errors.mock.calls.at(-1)?.arguments[2]), /^agents 上报没有可收的数据：codingUsage：/);
});
