import assert from "node:assert/strict";
import test from "node:test";

import { getPulseStatus, pulseKey, pulseScoresKey } from "@/lib/pulse";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { PULSE_SCORE_MAX_AGE_MS } from "@/lib/limits";
import { PULSE_DOMAINS, type PulseScoreRecord } from "@/lib/types";

const NOW = 1_770_000_000_000;
const HOUR = 3_600_000;

function record(overrides: Partial<PulseScoreRecord> = {}): PulseScoreRecord {
  return {
    scoredAt: NOW - 5 * 60_000,
    window: { from: NOW - 24 * HOUR - 5 * 60_000, to: NOW - 5 * 60_000 },
    domains: Object.fromEntries(PULSE_DOMAINS.map((domain) => [domain, {
      score: 1.5,
      confidence: 0.8,
      trend: "steady" as const,
      latestSampleAt: NOW - HOUR,
    }])) as PulseScoreRecord["domains"],
    ...overrides,
  };
}

async function withStorage(run: (storage: FakeStorage) => Promise<void>) {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await run(storage);
  } finally {
    resetStorageForTests();
  }
}

test("公开端点剥掉 hint，并保留窗口之前那一笔（压到窗口起点）", async () => {
  await withStorage(async (storage) => {
    await storage.append(
      pulseKey("listening"),
      JSON.stringify({ t: NOW - 30 * HOUR, level: 3, hint: "老的" }),
      JSON.stringify({ t: NOW - 26 * HOUR, level: 0 }),
      JSON.stringify({ t: NOW - 2 * HOUR, level: 3, hint: "Yoasobi – 夜に駆ける" }),
    );

    const payload = await getPulseStatus(NOW);

    assert.equal(payload.generatedAt, NOW);
    assert.equal(payload.window.to - payload.window.from, 24 * HOUR);
    assert.deepEqual(payload.domains.listening.samples, [
      { t: payload.window.from, level: 0 },
      { t: NOW - 2 * HOUR, level: 3 },
    ]);
    // 六个域一个都不能少，没有数据的那些是空序列
    assert.deepEqual(payload.domains.gaming.samples, []);
    const json = JSON.stringify(payload);
    assert.equal(json.includes("hint"), false);
    assert.equal(json.includes("Yoasobi"), false);
  });
});

test("有分就按域配上，没存过分就是 null", async () => {
  await withStorage(async (storage) => {
    assert.equal((await getPulseStatus(NOW)).domains.coding.score, null);
    await storage.set(pulseScoresKey(), JSON.stringify(record()));
    const payload = await getPulseStatus(NOW);
    assert.deepEqual(payload.domains.coding.score, {
      value: 1.5,
      confidence: 0.8,
      trend: "steady",
      scoredAt: NOW - 5 * 60_000,
    });
  });
});

test("存着的那份坏了就当没有分，不把半份数据画成分数", async () => {
  await withStorage(async (storage) => {
    const broken = record();
    // @ts-expect-error 故意写坏一个域，模拟旧版本或半截写入
    broken.domains.gaming = { score: "high", trend: "steady", confidence: null, latestSampleAt: null };
    await storage.set(pulseScoresKey(), JSON.stringify(broken));
    const payload = await getPulseStatus(NOW);
    for (const domain of PULSE_DOMAINS) assert.equal(payload.domains[domain].score, null);
  });
});

test("分太老就不给：评的是早已滑走的窗口，配着空泳道只会误导", async () => {
  await withStorage(async (storage) => {
    await storage.set(pulseScoresKey(), JSON.stringify(record({ scoredAt: NOW - PULSE_SCORE_MAX_AGE_MS - 1 })));
    assert.equal((await getPulseStatus(NOW)).domains.coding.score, null);
    await storage.set(pulseScoresKey(), JSON.stringify(record({ scoredAt: NOW - PULSE_SCORE_MAX_AGE_MS })));
    assert.notEqual((await getPulseStatus(NOW)).domains.coding.score, null);
  });
});
