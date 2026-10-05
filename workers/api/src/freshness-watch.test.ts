import assert from "node:assert/strict";
import test from "node:test";

import { CRON_HEARTBEAT_EVERY_MINUTES } from "@/lib/sentry";
import { SERVER_STALE_MS } from "@/lib/freshness";
import { LAG_KEYS, readLag } from "@shared/lag";
import { QUEST_STALE_MS, questMirror } from "@shared/quest";
import type { StorageCommand, StorageResult } from "@shared/storage-contract";
import {
  FRESHNESS_CHECK_EVERY_ROUNDS,
  freshnessCheckDue,
  watchFreshness,
  type FreshnessEvent,
} from "./freshness-watch.ts";

const NOW = Date.UTC(2026, 9, 5, 12, 2, 0);

function fakeLag(seed: Record<string, { updatedAt: number; data: unknown }> = {}) {
  const rows = new Map(Object.entries(seed).map(([key, entry]) => [key, JSON.stringify(entry)]));
  let puts = 0;
  return {
    get puts() { return puts; },
    async get(key: string) { return rows.get(key) ?? null; },
    async put(key: string, value: string) { puts += 1; rows.set(key, value); },
  };
}

function hub(values: Record<string, unknown>) {
  return async (commands: StorageCommand[]): Promise<StorageResult[] | null> =>
    commands.map(({ key }) => (key in values ? JSON.stringify(values[key]) : null));
}

async function run(lag: ReturnType<typeof fakeLag>, hubRead = hub({})) {
  const emitted: FreshnessEvent[] = [];
  await watchFreshness({ now: NOW, lag, hubRead, emit: (event) => emitted.push(event) });
  return emitted;
}

const server = (age: number) => ({ [LAG_KEYS.server]: { updatedAt: NOW - age, data: {} } });
const quest = (age: number) => ({
  [questMirror.key]: { observedAt: NOW - age, receivedAt: NOW - age, discordStatus: "online", playing: null },
});

test("新鲜到断流发一条 stale 并记下状态", async () => {
  const lag = fakeLag(server(SERVER_STALE_MS + 60_000));
  const events = await run(lag);
  assert.deepEqual(events.map(({ source, state }) => [source, state]), [["server", "stale"]]);
  assert.equal(events[0]!.thresholdMs, SERVER_STALE_MS);
  assert.equal(lag.puts, 1);
  assert.deepEqual((await readLag(lag, LAG_KEYS.freshnessWatch))?.data, { server: "stale" });
});

test("状态没翻转既不发也不写", async () => {
  const lag = fakeLag({ ...server(SERVER_STALE_MS + 60_000), [LAG_KEYS.freshnessWatch]: { updatedAt: 0, data: { server: "stale" } } });
  assert.deepEqual(await run(lag), []);
  const fresh = fakeLag(server(60_000));
  assert.deepEqual(await run(fresh), []);
  assert.equal(lag.puts + fresh.puts, 0);
});

test("断流到恢复发一条 recovered", async () => {
  const lag = fakeLag({ ...server(60_000), [LAG_KEYS.freshnessWatch]: { updatedAt: 0, data: { server: "stale" } } });
  const events = await run(lag);
  assert.deepEqual(events.map(({ source, state }) => [source, state]), [["server", "recovered"]]);
  assert.deepEqual((await readLag(lag, LAG_KEYS.freshnessWatch))?.data, { server: "fresh" });
});

test("StateHub 来源按 questNow 的口径判断断流", async () => {
  const events = await run(fakeLag(), hub(quest(QUEST_STALE_MS)));
  assert.deepEqual(events.map(({ source, state }) => [source, state]), [["quest", "stale"]]);
  assert.deepEqual(await run(fakeLag(), hub(quest(QUEST_STALE_MS - 1))), []);
});

test("StateHub 读不到时不下结论，不把读故障报成恢复", async () => {
  const seed = { [LAG_KEYS.freshnessWatch]: { updatedAt: 0, data: { quest: "stale" } } };
  const notReady = fakeLag(seed);
  assert.deepEqual(await run(notReady, async () => null), []);
  const broken = fakeLag(seed);
  assert.deepEqual(await run(broken, async () => { throw new Error("hub down"); }), []);
  assert.equal(notReady.puts + broken.puts, 0);
});

test("一个 KV 键读失败只跳过它，其他来源照常判断", async () => {
  const lag = fakeLag(server(SERVER_STALE_MS + 60_000));
  const get = lag.get.bind(lag);
  lag.get = async (key: string) => {
    if (key === LAG_KEYS.githubChart) throw new Error("kv down");
    return get(key);
  };
  const events = await run(lag);
  assert.deepEqual(events.map(({ source, state }) => [source, state]), [["server", "stale"]]);
});

test("每 FRESHNESS_CHECK_EVERY_ROUNDS 轮查一次", () => {
  const round = CRON_HEARTBEAT_EVERY_MINUTES * 60_000;
  const due = Array.from({ length: FRESHNESS_CHECK_EVERY_ROUNDS * 2 }, (_, index) => freshnessCheckDue(index * round + 2 * 60_000));
  assert.equal(due.filter(Boolean).length, 2);
  assert.equal(due[0], true);
});
