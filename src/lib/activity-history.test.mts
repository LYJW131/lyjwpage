import assert from "node:assert/strict";
import test from "node:test";

import {
  activityHistoryKey,
  planActivitySample,
  readActivityHistory,
} from "@/lib/activity-history";
import { ACTIVITY_HISTORY_LIMIT, ACTIVITY_HISTORY_REPEAT_AFTER_MS } from "@/lib/limits";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { ACTIVITY_DOMAINS, type ActivitySample } from "@/lib/types";
import { recordActivity } from "@api/stores/activity-history";

const FIVE_MIN = ACTIVITY_HISTORY_REPEAT_AFTER_MS;

function sample(t: number, level: ActivitySample["level"], hint?: string): ActivitySample {
  return hint ? { t, level, hint } : { t, level };
}

test("planActivitySample：第一笔、乱序、翻面、hint 变化、5 分钟确认、空闲单点", () => {
  assert.deepEqual(planActivitySample(null, { t: 10, level: 0 }), sample(10, 0));
  assert.deepEqual(planActivitySample(null, { t: 10, level: 2, hint: "Cursor" }), sample(10, 2, "Cursor"));

  assert.equal(planActivitySample(sample(10, 1), { t: 10, level: 3 }), null);
  assert.equal(planActivitySample(sample(10, 1), { t: 9, level: 3 }), null);

  assert.deepEqual(planActivitySample(sample(10, 1), { t: 11, level: 3 }), sample(11, 3));
  assert.deepEqual(
    planActivitySample(sample(10, 2, "a"), { t: 11, level: 2, hint: "b" }),
    sample(11, 2, "b"),
  );

  assert.deepEqual(
    planActivitySample(sample(10, 2, "a"), { t: 10 + FIVE_MIN, level: 2, hint: "a" }),
    sample(10 + FIVE_MIN, 2, "a"),
  );
  assert.equal(
    planActivitySample(sample(10, 2, "a"), { t: 10 + FIVE_MIN - 1, level: 2, hint: "a" }),
    null,
  );
  assert.equal(planActivitySample(sample(10, 0), { t: 10 + FIVE_MIN, level: 0 }), null);
  assert.equal(planActivitySample(sample(10, 0), { t: 10 + FIVE_MIN * 10, level: 0 }), null);

  assert.equal(planActivitySample(sample(10, 2, "a"), { t: 11, level: 2, hint: " a " }), null);
  assert.deepEqual(planActivitySample(null, { t: 1, level: 1, hint: "  " }), sample(1, 1));
});

test("recordActivity 写入、裁到上限、since 全量 / 增量 / 过旧游标", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    await recordActivity("coding", { t: 10, level: 0 });
    await recordActivity("coding", { t: 20, level: 0 });
    assert.deepEqual(await storage.listRange(activityHistoryKey("coding"), 0, -1), [
      JSON.stringify(sample(10, 0)),
    ]);

    await recordActivity("listening", { t: 100, level: 2, hint: "a" });
    await recordActivity("listening", { t: 200, level: 3, hint: "b" });
    await recordActivity("listening", { t: 300, level: 3, hint: "c" });
    await recordActivity("listening", { t: 400, level: 1, hint: "d" });

    const full = await readActivityHistory();
    assert.deepEqual(full.series.listening, {
      samples: [sample(100, 2, "a"), sample(200, 3, "b"), sample(300, 3, "c"), sample(400, 1, "d")],
      partial: false,
    });

    const partial = await readActivityHistory(200);
    assert.deepEqual(partial.series.listening, {
      samples: [sample(300, 3, "c"), sample(400, 1, "d")],
      partial: true,
    });

    const tooOld = await readActivityHistory(50);
    assert.equal(tooOld.series.listening.partial, false);
    assert.equal(tooOld.series.listening.samples.length, 4);

    for (let i = 0; i < ACTIVITY_HISTORY_LIMIT + 1; i += 1) {
      await recordActivity("gaming", { t: 1000 + i, level: 1, hint: `g${i}` });
    }
    const trimmed = await storage.listRange(activityHistoryKey("gaming"), 0, -1);
    assert.equal(trimmed.length, ACTIVITY_HISTORY_LIMIT);
    assert.equal(JSON.parse(trimmed[0]!).hint, "g1");
    assert.equal(JSON.parse(trimmed[trimmed.length - 1]!).hint, `g${ACTIVITY_HISTORY_LIMIT}`);
  } finally {
    resetStorageForTests();
  }
});

test("readActivityHistory 五域都在，空库是空数组，坏行跳过", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const empty = await readActivityHistory();
    assert.deepEqual(
      ACTIVITY_DOMAINS.map((domain) => empty.series[domain]),
      ACTIVITY_DOMAINS.map(() => ({ samples: [], partial: false })),
    );

    const k = activityHistoryKey("watching");
    await storage.append(
      k,
      JSON.stringify(sample(1, 3, "ok")),
      "not-json",
      JSON.stringify({ t: 2 }),
      JSON.stringify({ t: 3, level: 9 }),
      JSON.stringify(sample(4, 2, "later")),
    );
    const payload = await readActivityHistory();
    assert.deepEqual(payload.series.watching, {
      samples: [sample(1, 3, "ok"), sample(4, 2, "later")],
      partial: false,
    });
    for (const domain of ACTIVITY_DOMAINS) {
      assert.ok(domain in payload.series);
    }
  } finally {
    resetStorageForTests();
  }
});
