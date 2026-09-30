import assert from "node:assert/strict";
import test from "node:test";

import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { STATUS_VIEWS } from "@/lib/status-views";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { withRequestState } from "@shared/request-state";

import { collectIngestEffects, dispatchIngestEffects, type CollectedIngest } from "./ingest-effects";
import { prepareIngest, type CoreCommand } from "@shared/ingest/prepare";

import { commitPreparedIngest } from "./ingest-handlers";
import { requestStore, type Env } from "./runtime";


const NOW = 1_800_000_000_000;

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    LIVE_PUSH: {
      idFromName: () => null,
      get: () => ({ broadcast: async () => {} }),
    } as unknown as Env["LIVE_PUSH"],
    ...overrides,
  } as Env;
}

async function inRequest<T>(env: Env, run: () => Promise<T>): Promise<T> {
  const pending: Promise<unknown>[] = [];
  try {
    return await requestStore.run({
      env,
      ctx: { waitUntil: (promise) => { pending.push(promise); } },
    }, () => withRequestState(run));
  } finally {
    await Promise.allSettled(pending);
  }
}

async function land(env: Env, source: string, body: unknown, at: number): Promise<CollectedIngest<unknown>> {
  const command = await prepareIngest(source, body, at, { head: async () => ({}) }) as CoreCommand;
  const result = await inRequest(env, () => collectIngestEffects(() => commitPreparedIngest(command)));
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result;
}

function tagsOf(result: CollectedIngest<unknown>): string[] {
  return result.effects.flatMap((effect) => effect.kind === "tags" ? effect.tags : []);
}

function withStorage(run: () => Promise<void>) {
  return async () => {
    installStorageForTests(new FakeStorage());
    try { await run(); } finally { resetStorageForTests(); }
  };
}

function mac(modules: Record<string, unknown>, at: number) {
  return { version: 4, presence: "online", heartbeatAt: at, activeModules: ["charger"], modules };
}

function charger(connected: boolean, totalOutputW: number, at: number) {
  return mac({ chargingDevices: { devices: [
    { id: "charger", kind: "charger", connected, updatedAt: at, totalOutputW },
  ] } }, at);
}

test("充电头：插上和拔下失效首屏，插着时功率滚动不失效", withStorage(async () => {
  const env = testEnv();
  const tag = STATUS_VIEWS.charger.tag;
  assert.ok(tagsOf(await land(env, "mac", charger(true, 40, NOW), NOW)).includes(tag));
  assert.ok(!tagsOf(await land(env, "mac", charger(true, 41.37, NOW + 5_000), NOW + 5_000)).includes(tag));
  assert.ok(tagsOf(await land(env, "mac", charger(false, 0, NOW + 10_000), NOW + 10_000)).includes(tag));
}));

function playing(positionTicks: number | null) {
  return {
    playing: positionTicks === null ? null : {
      itemId: "item-1",
      paused: false,
      positionTicks,
      runTimeTicks: 10 ** 15,
    },
  };
}

test("Emby：开播和停播失效首屏，进度更新不失效", withStorage(async () => {
  const env = testEnv();
  const tag = STATUS_VIEWS.nowWatching.tag;
  assert.ok(tagsOf(await land(env, "emby", playing(0), NOW)).includes(tag));
  assert.ok(!tagsOf(await land(env, "emby", playing(600_000_000), NOW + 60_000)).includes(tag));
  assert.ok(tagsOf(await land(env, "emby", playing(null), NOW + 120_000)).includes(tag));
}));

function usageAgent(id: string, tokens: number, at: number) {
  return {
    id,
    state: "ok",
    collectedAt: at,
    sessionCount: 1,
    days: [{
      date: "2026-09-05", inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
      totalTokens: tokens, apiEquivalentCostUSD: tokens / 100, costComplete: true, models: [{ model: "model", tokens }],
    }],
  };
}

function usage(agents: ReturnType<typeof usageAgent>[], at: number) {
  return { version: 4, presence: "online", heartbeatAt: at, activeModules: ["coding"], modules: { codingUsage: { agents } } };
}

test("Coding：视图在提交时重算，卡片骨架（行数、总量、常用模型）变了才失效首屏", withStorage(async () => {
  let revalidates = 0;
  const env = testEnv({ SITE_URL: "https://site.example", REVALIDATE_SECRET: "secret" } as Partial<Env>);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input) === "https://site.example/api/revalidate") {
      revalidates += 1;
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected fetch ${String(input)}`);
  }) as typeof fetch;
  try {
    const dispatch = async (result: CollectedIngest<unknown>) => {
      await inRequest(env, () => dispatchIngestEffects(result.effects));
    };
    const first = await land(env, "mac", usage([usageAgent("claude", 100, NOW)], NOW), NOW);
    assert.ok(tagsOf(first).includes(STATUS_VIEWS.coding.tag));
    await dispatch(first);
    assert.equal(revalidates, 1);
    const content = await land(env, "mac", usage([usageAgent("claude", 200, NOW + 1)], NOW + 1), NOW + 1);
    assert.deepEqual(tagsOf(content), []);
    await dispatch(content);
    assert.equal(revalidates, 1);
    const grown = await land(env, "mac", usage([usageAgent("claude", 300, NOW + 2), usageAgent("codex", 5, NOW + 2)], NOW + 2), NOW + 2);
    assert.ok(tagsOf(grown).includes(STATUS_VIEWS.coding.tag));
    await dispatch(grown);
    assert.equal(revalidates, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
}));
