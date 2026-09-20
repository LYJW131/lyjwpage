import assert from "node:assert/strict";
import test from "node:test";

import {
  planPulseSample,
  pulseKey,
  readPulseHistory,
} from "@/lib/pulse";
import { PULSE_HISTORY_LIMIT, PULSE_REPEAT_AFTER_MS } from "@/lib/limits";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { PULSE_DOMAINS, type PulseSample } from "@/lib/types";
import { recordPulse } from "@api/stores/pulse";

const FIVE_MIN = PULSE_REPEAT_AFTER_MS;

function sample(t: number, level: PulseSample["level"], hint?: string): PulseSample {
  return hint ? { t, level, hint } : { t, level };
}

test("planPulseSample：第一笔、乱序、翻面、hint 变化、5 分钟确认、空闲心跳", () => {
  assert.deepEqual(planPulseSample(null, { t: 10, level: 0 }), sample(10, 0));
  assert.deepEqual(planPulseSample(null, { t: 10, level: 2, hint: "Cursor" }), sample(10, 2, "Cursor"));

  assert.equal(planPulseSample(sample(10, 1), { t: 10, level: 3 }), null);
  assert.equal(planPulseSample(sample(10, 1), { t: 9, level: 3 }), null);

  assert.deepEqual(planPulseSample(sample(10, 1), { t: 11, level: 3 }), sample(11, 3));
  assert.deepEqual(
    planPulseSample(sample(10, 2, "a"), { t: 11, level: 2, hint: "b" }),
    sample(11, 2, "b"),
  );

  assert.deepEqual(
    planPulseSample(sample(10, 2, "a"), { t: 10 + FIVE_MIN, level: 2, hint: "a" }),
    sample(10 + FIVE_MIN, 2, "a"),
  );
  assert.equal(
    planPulseSample(sample(10, 2, "a"), { t: 10 + FIVE_MIN - 1, level: 2, hint: "a" }),
    null,
  );
  assert.deepEqual(planPulseSample(sample(10, 0), { t: 10 + FIVE_MIN, level: 0 }), sample(10 + FIVE_MIN, 0));
  assert.deepEqual(planPulseSample(sample(10, 0), { t: 10 + FIVE_MIN * 10, level: 0 }), sample(10 + FIVE_MIN * 10, 0));

  assert.equal(planPulseSample(sample(10, 2, "a"), { t: 11, level: 2, hint: " a " }), null);
  assert.deepEqual(planPulseSample(null, { t: 1, level: 1, hint: "  " }), sample(1, 1));
});

test("recordPulse 写入、裁到上限、游标全量 / 增量 / 过旧游标", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await recordPulse("coding", { t: 10, level: 0 });
    await recordPulse("coding", { t: 20, level: 0 });
    assert.deepEqual(await storage.listRange(pulseKey("coding"), 0, -1), [
      JSON.stringify(sample(10, 0)),
    ]);

    await recordPulse("listening", { t: 100, level: 2, hint: "a" });
    await recordPulse("listening", { t: 200, level: 3, hint: "b" });
    await recordPulse("listening", { t: 300, level: 3, hint: "c" });
    await recordPulse("listening", { t: 400, level: 1, hint: "d" });

    const full = await readPulseHistory();
    assert.deepEqual(full.series.listening, {
      samples: [sample(100, 2, "a"), sample(200, 3, "b"), sample(300, 3, "c"), sample(400, 1, "d")],
      partial: false,
    });

    const partial = await readPulseHistory(200);
    assert.deepEqual(partial.series.listening, {
      samples: [sample(300, 3, "c"), sample(400, 1, "d")],
      partial: true,
    });

    const tooOld = await readPulseHistory(50);
    assert.equal(tooOld.series.listening.partial, false);
    assert.equal(tooOld.series.listening.samples.length, 4);

    for (let i = 0; i < PULSE_HISTORY_LIMIT + 1; i += 1) {
      await recordPulse("gaming", { t: 1000 + i, level: 1, hint: `g${i}` });
    }
    const trimmed = await storage.listRange(pulseKey("gaming"), 0, -1);
    assert.equal(trimmed.length, PULSE_HISTORY_LIMIT);
    assert.equal(JSON.parse(trimmed[0]!).hint, "g1");
    assert.equal(JSON.parse(trimmed[trimmed.length - 1]!).hint, `g${PULSE_HISTORY_LIMIT}`);
  } finally {
    resetStorageForTests();
  }
});

test("readPulseHistory 六域都在，空库是空数组，坏行跳过", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const empty = await readPulseHistory();
    assert.deepEqual(
      PULSE_DOMAINS.map((domain) => empty.series[domain]),
      PULSE_DOMAINS.map(() => ({ samples: [], partial: false })),
    );

    const k = pulseKey("watching");
    await storage.append(
      k,
      JSON.stringify(sample(1, 3, "ok")),
      "not-json",
      JSON.stringify({ t: 2 }),
      JSON.stringify({ t: 3, level: 9 }),
      JSON.stringify(sample(4, 2, "later")),
    );
    const payload = await readPulseHistory();
    assert.deepEqual(payload.series.watching, {
      samples: [sample(1, 3, "ok"), sample(4, 2, "later")],
      partial: false,
    });
    for (const domain of PULSE_DOMAINS) {
      assert.ok(domain in payload.series);
    }
  } finally {
    resetStorageForTests();
  }
});
