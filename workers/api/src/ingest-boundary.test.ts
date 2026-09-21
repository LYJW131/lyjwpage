import assert from "node:assert/strict";
import test from "node:test";

import { readChargerState } from "@/lib/charger-store";
import { getImageObjectKeys } from "@/lib/emby-store";
import { readLiveness } from "@/lib/reporter-liveness";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { HIDDEN_DESKTOP_BUNDLE_ID } from "@/lib/types";
import { getWorkoutsSnapshot } from "@/lib/workouts";
import { withRequestState } from "@shared/request-state";
import { K_LAST_PUSH } from "@shared/charger-store";
import { limitsMirror } from "@shared/vibecoding";
import { mirror as telemetryMirror } from "@shared/telemetry";
import { nowMirror } from "@shared/vibecoding";

import { fanout } from "./fanout";
import { collectIngestEffects, dispatchIngestEffects, type CollectedIngest } from "./ingest-effects";
import { commitPreparedIngest, prepareIngest, prepareIngestForCommit, type PreparedIngest } from "./ingest-handlers";
import type { PreparedTelemetryEnvelope } from "./stores/telemetry";
import { requestStore, type Env } from "./runtime";
import { resetStoredImageCacheForTests } from "./r2-assets";

const NOW = 1_800_000_000_000;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function envelope(modules: Record<string, unknown>, activeModules: string[] = []) {
  return { version: 4, presence: "online", heartbeatAt: NOW, activeModules, modules };
}

function testEnv(head: (key: string) => Promise<unknown | null> = async () => ({})): Env {
  return {
    IMAGES: { head } as unknown as R2Bucket,
    LIVE_PUSH: {
      idFromName: () => null,
      get: () => ({ broadcast: async () => { throw new Error("DO commit must not broadcast"); } }),
    } as unknown as Env["LIVE_PUSH"],
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

async function commit(env: Env, command: PreparedIngest): Promise<CollectedIngest<unknown>> {
  return inRequest(env, () => collectIngestEffects(() => commitPreparedIngest(command)));
}

test("ingest preparation only checks readiness after invalid input", async () => {
  let readyCalls = 0;
  const valid = await prepareIngestForCommit("iphone", { version: 1 }, async () => {
    readyCalls += 1;
    return false;
  });
  assert.equal(valid?.source, "iphone");
  assert.equal(readyCalls, 0, "valid reports must proceed directly to commitIngest");

  const unavailable = await prepareIngestForCommit("iphone", {}, async () => {
    readyCalls += 1;
    return false;
  });
  assert.equal(unavailable, null);
  assert.equal(readyCalls, 1);

  await assert.rejects(
    prepareIngestForCommit("iphone", {}, async () => {
      readyCalls += 1;
      return true;
    }),
    /version 必须为 1/,
  );
  assert.equal(readyCalls, 2);
});

test("Mac late validation keeps liveness but does not invent a charger heartbeat", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest(
      "mac",
      envelope({ chargingDevices: "bad" }, ["charger"]),
      NOW,
    ));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal((await readLiveness()).lastSeenAt, NOW);
    assert.equal(await storage.get(K_LAST_PUSH), null);
  } finally { resetStorageForTests(); }
});

test("Mac commits the charger before a later malformed power bank and omits later modules", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest("mac", envelope({
      chargingDevices: { devices: [
        { id: "charger", kind: "charger", connected: true, updatedAt: NOW, totalOutputW: 40 },
        { id: "bank", kind: "powerBank", connected: true },
      ] },
      desktop: { applicationName: "Should not land" },
    }, ["charger", "desktop"]), NOW));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal((await readChargerState()).previous?.status.totalPower, 40);
    assert.equal(result.effects.some((effect) => effect.kind === "event" && effect.event.type === "desktop"), false);
  } finally { resetStorageForTests(); }
});

test("Mac keeps an earlier charger write when desktop validation fails and does not commit later coding", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest("mac", envelope({
      chargingDevices: { devices: [
        { id: "charger", kind: "charger", connected: true, updatedAt: NOW, totalOutputW: 32 },
      ] },
      desktop: { bundleIdentifier: "missing.application.name" },
      vibeCodingNow: { agents: [{ id: "codex", active: true }] },
    }, ["charger", "desktop", "vibeCoding"]), NOW));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal((await readChargerState()).previous?.status.totalPower, 32);
    assert.equal(await nowMirror.get(), null);
  } finally { resetStorageForTests(); }
});

test("a later Mac module failure does not notify an unpersisted telemetry patch", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest("mac", envelope({
      desktop: { applicationName: "Cursor", observedAt: NOW },
      appleMusicCredentials: {},
    }, ["desktop"]), NOW));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal(await telemetryMirror.get(), null);
    assert.equal(result.effects.some((effect) =>
      effect.kind === "event" && effect.event.type === "desktop"), false);
    assert.equal(result.effects.some((effect) =>
      effect.kind === "tags" && effect.tags.includes("desktop")), false);
  } finally { resetStorageForTests(); }
});

test("iPhone keeps workouts when the following activity module is invalid", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const workout = {
      id: "11111111-1111-4111-8111-111111111111",
      activityType: "Running",
      startedAt: NOW - 3_600_000,
      endedAt: NOW - 1_800_000,
      durationSeconds: 1_500,
      secondsFromGMT: 0,
    };
    const command = await inRequest(testEnv(), () => prepareIngest("iphone", {
      version: 1,
      modules: { workouts: { items: [workout] }, activity: { date: "bad" } },
    }, NOW));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal((await getWorkoutsSnapshot()).items[0]?.id, workout.id);
  } finally { resetStorageForTests(); }
});

test("fanout exposes no notification when its corresponding durable write fails", async () => {
  const result = await inRequest(testEnv(), () => collectIngestEffects(() => fanout({
    writes: [Promise.reject(new Error("write failed"))],
    events: [{ type: "presence", payload: null }],
    tags: ["desktop"],
  })));
  assert.equal(result.ok, false);
  assert.deepEqual(result.effects, []);
});

test("one failed event does not turn a durable commit into failure or drop other effects", async () => {
  const previous = console.error;
  console.error = () => {};
  try {
    const result = await inRequest(testEnv(), () => collectIngestEffects(() => fanout({
      writes: [Promise.resolve()],
      events: [
        Promise.reject(new Error("optional decoration failed")),
        { type: "presence", payload: null },
      ],
      tags: ["desktop"],
    })));
    assert.equal(result.ok, true);
    assert.deepEqual(result.effects, [
      { kind: "event", event: { type: "presence", payload: null } },
      { kind: "tags", tags: ["desktop"] },
    ]);
  } finally {
    console.error = previous;
  }
});

test("Emby R2 HEAD runs during Worker preparation and does not block another source commit", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let heads = 0;
  const env = testEnv(async () => { heads += 1; await blocked; return {}; });
  try {
    const emby = inRequest(env, () => prepareIngest("emby", {
      images: [{ imageKey: "item:poster", objectKey: `${HASH_A}.webp` }],
    }, NOW));
    await Promise.resolve();
    assert.equal(heads, 1);

    const phone = await inRequest(env, () => prepareIngest("iphone", { version: 1 }, NOW));
    const phoneResult = await commit(env, phone);
    assert.equal(phoneResult.ok, true);
    release();
    const preparedEmby = await emby;

    resetStoredImageCacheForTests();
    let commitHeads = 0;
    const noR2Env = testEnv(async () => { commitHeads += 1; return {}; });
    const embyResult = await commit(noR2Env, preparedEmby);
    assert.equal(embyResult.ok, true);
    assert.equal(commitHeads, 0);
  } finally { release(); resetStorageForTests(); }
});

test("Emby image commits merge against the latest map without losing concurrent keys", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const [first, second] = await Promise.all([
      inRequest(env, () => prepareIngest("emby", { images: [{ imageKey: "a", objectKey: `${HASH_A}.webp` }] }, NOW)),
      inRequest(env, () => prepareIngest("emby", { images: [{ imageKey: "b", objectKey: `${HASH_B}.webp` }] }, NOW + 1)),
    ]);
    assert.equal((await commit(env, first)).ok, true);
    assert.equal((await commit(env, second)).ok, true);
    assert.deepEqual(await getImageObjectKeys(), { a: `${HASH_A}.webp`, b: `${HASH_B}.webp` });
  } finally { resetStorageForTests(); }
});

test("agent limit commits merge ids instead of replacing a concurrent update", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const first = await inRequest(env, () => prepareIngest("agents", {
      agents: [{ id: "codex", plan: { tier: "pro" }, limits: [] }],
      collectedAt: new Date(NOW).toISOString(),
    }, NOW));
    const second = await inRequest(env, () => prepareIngest("agents", {
      agents: [{ id: "claude", plan: { tier: "max" }, limits: [] }],
      collectedAt: new Date(NOW + 1).toISOString(),
    }, NOW + 1));
    assert.equal((await commit(env, first)).ok, true);
    assert.equal((await commit(env, second)).ok, true);
    assert.deepEqual(Object.keys((await limitsMirror.get())?.agents ?? {}).sort(), ["claude", "codex"]);
  } finally { resetStorageForTests(); }
});

test("desktop icon commits merge the latest map without losing another report", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const make = (name: string, iconHash: string, objectKey: string, at: number) =>
      inRequest(env, () => prepareIngest("mac", envelope({ desktop: {
        applicationName: name,
        iconHash,
        iconObjectKey: objectKey,
        observedAt: at,
      } }, ["desktop"]), at));
    const first = await make("First", HASH_A, `${HASH_A}.webp`, NOW);
    const second = await make("Second", HASH_B, `${HASH_B}.webp`, NOW + 1);
    assert.equal((await commit(env, first)).ok, true);
    assert.equal((await commit(env, second)).ok, true);
    assert.deepEqual((await telemetryMirror.get())?.desktopIconAssets, [
      [HASH_A, `${HASH_A}.webp`],
      [HASH_B, `${HASH_B}.webp`],
    ]);
  } finally { resetStorageForTests(); }
});

test("listening effects retain the track from their own commit", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("network called during commit");
  }) as typeof fetch;
  try {
    const make = (title: string, at: number) => inRequest(env, () => prepareIngest("mac", envelope({
      appleMusic: { state: "playing", title, artist: "Artist", observedAt: at },
    }, ["appleMusic"]), at));
    const first = await make("First", NOW);
    const second = await make("Second", NOW + 1);
    const firstResult = await commit(env, first);
    const secondResult = await commit(env, second);
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    const title = (result: CollectedIngest<unknown>) => result.effects.find(
      (effect) => effect.kind === "listening",
    )?.kind === "listening"
      ? result.effects.find((effect) => effect.kind === "listening")!.mac?.music?.title
      : null;
    assert.equal(title(firstResult), "First");
    assert.equal(title(secondResult), "Second");
    assert.equal(fetches, 0);
    let broadcasts = 0;
    const dispatchEnv = {
      ...env,
      LIVE_PUSH: {
        idFromName: () => null,
        get: () => ({ broadcast: async () => { broadcasts += 1; } }),
      },
    } as unknown as Env;
    await inRequest(dispatchEnv, () => dispatchIngestEffects(firstResult.effects));
    assert.equal(broadcasts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetStorageForTests();
  }
});

test("commit performs no room or Vercel I/O and Worker dispatch performs both", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  let broadcasts = 0;
  let revalidates = 0;
  const env = {
    ...testEnv(),
    SITE_URL: "https://site.example",
    TELEMETRY_INGEST_SECRET: "secret",
    LIVE_PUSH: {
      idFromName: () => null,
      get: () => ({ broadcast: async () => { broadcasts += 1; } }),
    },
  } as unknown as Env;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input) === "https://site.example/api/revalidate") {
      revalidates += 1;
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected fetch ${String(input)}`);
  }) as typeof fetch;
  try {
    const command = await inRequest(env, () => prepareIngest("mac", envelope({
      desktop: { applicationName: "Cursor", observedAt: NOW },
    }, ["desktop"]), NOW));
    const result = await commit(env, command);
    assert.equal(result.ok, true);
    assert.equal(broadcasts, 0);
    assert.equal(revalidates, 0);
    await inRequest(env, () => dispatchIngestEffects(result.effects));
    assert.equal(broadcasts, 1);
    assert.equal(revalidates, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetStorageForTests();
  }
});

/**
 * 窗口标题。入库和推送是同一份值，所以每条都两头都看 —— 只看其中一头的话，
 * 出口那侧漏拼一个字段可以一直不被发现。
 */

function desktopPush(result: CollectedIngest<unknown>) {
  const effect = result.effects.find(
    (item) => item.kind === "event" && item.event.type === "desktop",
  );
  if (!(effect?.kind === "event" && effect.event.type === "desktop")) {
    throw new Error("没有推送 desktop 事件");
  }
  const { desktop } = effect.event.payload;
  if (!desktop) throw new Error("desktop 推送里没有前台应用");
  return desktop;
}

async function landDesktop(env: Env, desktop: Record<string, unknown>) {
  const command = await inRequest(env, () =>
    prepareIngest("mac", envelope({ desktop }, ["desktop"]), NOW));
  const result = await commit(env, command);
  return { command, result };
}

test("desktop 的窗口标题入库并随推送发出", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const { result } = await landDesktop(env, {
      applicationName: "Ghostty",
      bundleIdentifier: "com.mitchellh.ghostty",
      windowTitle: "  ~/Developer/lyjwpage — zsh  ",
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    // 前后空白在入口就剪掉，存的和推的都是剪好的那一份
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, "~/Developer/lyjwpage — zsh");
    assert.equal(desktopPush(result).windowTitle, "~/Developer/lyjwpage — zsh");
  } finally { resetStorageForTests(); }
});

test("desktop 缺席或空白的窗口标题一律是 null，不是缺字段", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const blank = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "   ",
      observedAt: NOW,
    });
    assert.equal(blank.result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    const blankPush = desktopPush(blank.result);
    assert.equal(blankPush.windowTitle, null);
    // 是 null，不是整个字段不在 —— 消费方只判空
    assert.ok("windowTitle" in blankPush);

    const absent = await landDesktop(env, { applicationName: "Ghostty", observedAt: NOW + 1 });
    assert.equal(absent.result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    const absentPush = desktopPush(absent.result);
    assert.equal(absentPush.windowTitle, null);
    assert.ok("windowTitle" in absentPush);
  } finally { resetStorageForTests(); }
});

test("desktop 的超长窗口标题按码点截断，不劈开代理对", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    // 每个 emoji 一个码点、两个 UTF-16 码元：按码元切会在第 200 个位置留下半个字符
    const { result } = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "🎬".repeat(250),
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    const stored = (await telemetryMirror.get())?.desktop?.windowTitle;
    assert.equal(stored, "🎬".repeat(200));
    assert.equal([...(stored ?? "")].length, 200);
    assert.equal(desktopPush(result).windowTitle, stored);

    // 正好压线的一个字都不动
    const exact = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "标".repeat(200),
      observedAt: NOW + 1,
    });
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, "标".repeat(200));
    assert.equal(desktopPush(exact.result).windowTitle, "标".repeat(200));
  } finally { resetStorageForTests(); }
});

test("desktop 的窗口标题类型不对时该模块及其后的模块都不落地", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const { command, result } = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: 42,
      observedAt: NOW,
    });
    // 认准是 desktop 这一段炸的，不是随便哪个模块失败都算这条用例通过
    assert.equal((command as PreparedTelemetryEnvelope).failure?.stage, "beforeDesktop");
    assert.equal(result.ok, false);
    assert.equal(await telemetryMirror.get(), null);
    assert.equal(result.effects.some((effect) =>
      effect.kind === "event" && effect.event.type === "desktop"), false);
  } finally { resetStorageForTests(); }
});

test("隐藏前台应用时窗口标题被强制清空", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const { result } = await landDesktop(env, {
      applicationName: "Hidden",
      bundleIdentifier: HIDDEN_DESKTOP_BUNDLE_ID,
      windowTitle: "私密项目 — 不该出现在站点上",
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    assert.equal(desktopPush(result).windowTitle, null);
  } finally { resetStorageForTests(); }
});
