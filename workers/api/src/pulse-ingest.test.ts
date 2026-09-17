import assert from "node:assert/strict";
import test from "node:test";

import { PULSE_REPEAT_AFTER_MS } from "@/lib/limits";
import { MUSIC_PAUSE_GRACE_MS } from "@/lib/now-listening";
import { pulseKey } from "@/lib/pulse";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import type { PulseDomain, PulseSample } from "@/lib/types";
import { withRequestState } from "@shared/request-state";
import { requestStore, type Env } from "@api/runtime";
import { recordEmbyReport } from "@api/stores/emby";
import { recordTelemetryEnvelope } from "@api/stores/telemetry";

/**
 * pulse 的挂钩点，按信封驱动。
 *
 * 档位规则本身由 pulse-levels / pulse-listening 的纯函数测试守着；这里守的是
 * 「哪一封信封该落笔」：心跳也重算、模块关掉后不再算、少带详情时沿用存着的标题。
 */

const T0 = 1_760_000_000_000;

/**
 * 一次上报的作用域。
 *
 * `requestStore` 是必需的：fanout 的失效通知会问 `currentContext()`，没有作用域时
 * 它抛出去的错会盖住真正要看的断言。`waitUntil` 收下的后台任务在这里等干净，
 * 免得跨测试互相干扰。
 */
async function inRequest<T>(run: () => Promise<T>): Promise<T> {
  const pending: Promise<unknown>[] = [];
  const context = {
    // 广播那一路不是这几个测试要看的东西，给个不出声的房间，免得日志里全是 [live]
    env: {
      LIVE_PUSH: {
        idFromName: () => null,
        get: () => ({ broadcast: async () => {} }),
      },
    } as unknown as Env,
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    },
  };
  try {
    return await requestStore.run(context, () => withRequestState(run));
  } finally {
    await Promise.allSettled(pending);
  }
}

async function samples(storage: FakeStorage, domain: PulseDomain): Promise<PulseSample[]> {
  const rows = await storage.listRange(pulseKey(domain), 0, -1);
  return rows.map((row) => JSON.parse(row) as PulseSample);
}

function envelope(at: number, activeModules: string[], modules?: Record<string, unknown>) {
  return { version: 4, presence: "online", heartbeatAt: at, activeModules, modules };
}

function playing(state: "playing" | "paused", observedAt: number) {
  return {
    state,
    title: "Helpless",
    artist: "Hamilton",
    positionMs: 0,
    durationMs: 180_000,
    observedAt,
  };
}

test("Mac 纯心跳也重算在听：不到 5 分钟不灌表，满 5 分钟再确认一次", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await inRequest(() =>
      recordTelemetryEnvelope(
        envelope(T0, ["appleMusic"], { appleMusic: playing("playing", T0) }),
        T0,
      ),
    );
    assert.deepEqual(await samples(storage, "listening"), [
      { t: T0, level: 3, hint: "Hamilton – Helpless" },
    ]);

    // 心跳不带任何模块 —— 采集端只在内容变化时才带，这一封说的是「还在放同一首」
    const quiet = T0 + 60_000;
    await inRequest(() => recordTelemetryEnvelope(envelope(quiet, ["appleMusic"]), quiet));
    assert.equal((await samples(storage, "listening")).length, 1);

    const reconfirm = T0 + PULSE_REPEAT_AFTER_MS;
    await inRequest(() => recordTelemetryEnvelope(envelope(reconfirm, ["appleMusic"]), reconfirm));
    assert.deepEqual(await samples(storage, "listening"), [
      { t: T0, level: 3, hint: "Hamilton – Helpless" },
      { t: reconfirm, level: 3, hint: "Hamilton – Helpless" },
    ]);
  } finally {
    resetStorageForTests();
  }
});

test("暂停宽限期过期由下一条心跳落笔，不用等下一次真变化", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await inRequest(() =>
      recordTelemetryEnvelope(
        envelope(T0, ["appleMusic"], { appleMusic: playing("paused", T0) }),
        T0,
      ),
    );
    assert.deepEqual(await samples(storage, "listening"), [
      { t: T0, level: 2, hint: "Hamilton – Helpless" },
    ]);

    const expired = T0 + MUSIC_PAUSE_GRACE_MS * 3;
    await inRequest(() => recordTelemetryEnvelope(envelope(expired, ["appleMusic"]), expired));
    assert.deepEqual(await samples(storage, "listening"), [
      { t: T0, level: 2, hint: "Hamilton – Helpless" },
      { t: expired, level: 0 },
    ]);
  } finally {
    resetStorageForTests();
  }
});

test("desktop 模块关掉后，留着的前台应用不再被算成 coding", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await inRequest(() =>
      recordTelemetryEnvelope(
        envelope(T0, ["desktop"], {
          desktop: { applicationName: "Cursor", bundleIdentifier: "com.todesktop.230313mzl4w4u92" },
        }),
        T0,
      ),
    );
    assert.deepEqual(await samples(storage, "coding"), [{ t: T0, level: 2, hint: "Cursor" }]);

    // 模块下线；工作副本里那份 Cursor 还在，但它不再代表此刻
    const off = T0 + 60_000;
    await inRequest(() =>
      recordTelemetryEnvelope(
        envelope(off, ["vibeCodingNow"], {
          vibeCodingNow: { agents: [{ id: "claude", currentModel: "opus", active: false }] },
        }),
        off,
      ),
    );
    assert.deepEqual(await samples(storage, "coding"), [
      { t: T0, level: 2, hint: "Cursor" },
      { t: off, level: 0 },
    ]);
  } finally {
    resetStorageForTests();
  }
});

test("充电头只发心跳的那几分钟，charging 档位照样再确认", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await inRequest(() =>
      recordTelemetryEnvelope(
        envelope(T0, ["charger"], {
          chargingDevices: {
            devices: [
              {
                id: "sn-1",
                kind: "charger",
                model: "A2687",
                connected: true,
                updatedAt: T0,
                totalOutputW: 45,
                ports: [
                  { name: "C1", active: true, powerW: 45, attachedDevice: { model: "MacBook Pro" } },
                ],
              },
            ],
          },
        }),
        T0,
      ),
    );
    assert.deepEqual(await samples(storage, "charging"), [
      { t: T0, level: 2, hint: "MacBook Pro" },
    ]);

    // 这一封没带 chargingDevices，只把 charger 列在 activeModules 里（走 prepareHeartbeat）
    const reconfirm = T0 + PULSE_REPEAT_AFTER_MS;
    await inRequest(() => recordTelemetryEnvelope(envelope(reconfirm, ["charger"]), reconfirm));
    assert.deepEqual(await samples(storage, "charging"), [
      { t: T0, level: 2, hint: "MacBook Pro" },
      { t: reconfirm, level: 2, hint: "MacBook Pro" },
    ]);
  } finally {
    resetStorageForTests();
  }
});

test("Emby 只推位置更新时，watching 的 hint 沿用存着的标题", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await inRequest(() =>
      recordEmbyReport(
        {
          playing: {
            itemId: "42",
            paused: false,
            positionTicks: 0,
            runTimeTicks: 36_000_000_000,
            item: { id: "42", name: "Frieren", type: "Series" },
          },
        },
        T0,
      ),
    );
    assert.deepEqual(await samples(storage, "watching"), [{ t: T0, level: 3, hint: "Frieren" }]);

    const paused = T0 + 30_000;
    await inRequest(() =>
      recordEmbyReport(
        { playing: { itemId: "42", paused: true, positionTicks: 1, runTimeTicks: 36_000_000_000 } },
        paused,
      ),
    );
    assert.deepEqual(await samples(storage, "watching"), [
      { t: T0, level: 3, hint: "Frieren" },
      { t: paused, level: 2, hint: "Frieren" },
    ]);
  } finally {
    resetStorageForTests();
  }
});

test("itemId 对不上的存量详情不参与 hint", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await inRequest(() =>
      recordEmbyReport(
        {
          playing: {
            itemId: "42",
            paused: false,
            positionTicks: 0,
            runTimeTicks: 36_000_000_000,
            item: { id: "42", name: "Frieren", type: "Series" },
          },
        },
        T0,
      ),
    );

    const other = T0 + 30_000;
    await inRequest(() =>
      recordEmbyReport(
        { playing: { itemId: "77", paused: false, positionTicks: 0, runTimeTicks: 36_000_000_000 } },
        other,
      ),
    );
    assert.deepEqual(await samples(storage, "watching"), [
      { t: T0, level: 3, hint: "Frieren" },
      { t: other, level: 3 },
    ]);
  } finally {
    resetStorageForTests();
  }
});
