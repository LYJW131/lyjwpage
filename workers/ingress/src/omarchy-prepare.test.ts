import assert from "node:assert/strict";
import test from "node:test";

import { INGEST_FUTURE_SKEW_MS } from "@shared/freshness";
import { prepareOmarchyReport } from "@shared/ingest/omarchy";
import { resetStoredImageCacheForTests, type ImageBucket } from "@shared/ingest/r2-assets";

const NOW = Date.parse("2026-11-06T04:00:00Z");
const HASH = "a".repeat(64);
const KEY = `${HASH}.png`;

function bucket(keys: string[]): ImageBucket {
  return { head: async (objectKey) => (keys.includes(objectKey) ? {} : null) };
}

function report(desktop: unknown, observedAt = NOW - 1_000) {
  return { version: 1, observedAt, modules: { desktop } };
}

test("omarchy：前台窗口照收，空白字段归 null，标题按码点截到 200", async () => {
  const prepared = await prepareOmarchyReport(report({
    applicationName: " Ghostty ", appId: "com.mitchellh.ghostty", windowTitle: "😀".repeat(300), workspace: "  ",
  }), NOW, bucket([]));
  assert.equal(prepared.source, "omarchy");
  assert.deepEqual({ ...prepared.presence.desktop, windowTitle: undefined }, {
    applicationName: "Ghostty", appId: "com.mitchellh.ghostty", windowTitle: undefined, workspace: null,
    iconHash: null, iconObjectKey: null,
  });
  assert.equal([...prepared.presence.desktop!.windowTitle!].length, 200);
  assert.equal(prepared.presence.receivedAt, NOW);
});

test("omarchy：没有聚焦窗口时 desktop 为 null", async () => {
  assert.equal((await prepareOmarchyReport(report(null), NOW, bucket([]))).presence.desktop, null);
});

test("omarchy：图标对象键只在桶里查得到时收下，查不到留哈希", async () => {
  resetStoredImageCacheForTests();
  const desktop = { applicationName: "Ghostty", iconHash: HASH, iconObjectKey: KEY };
  const stored = await prepareOmarchyReport(report(desktop), NOW, bucket([KEY]));
  assert.equal(stored.presence.desktop?.iconObjectKey, KEY);
  resetStoredImageCacheForTests();
  const missing = await prepareOmarchyReport(report(desktop), NOW, bucket([]));
  assert.equal(missing.presence.desktop?.iconHash, HASH);
  assert.equal(missing.presence.desktop?.iconObjectKey, null);
});

test("omarchy：信封不对、缺 applicationName、图标字段不合法、时间超前都拒收", async () => {
  const desktop = { applicationName: "Ghostty" };
  for (const body of [
    { ...report(desktop), version: 2 },
    { version: 1, observedAt: NOW, modules: {} },
    report({ appId: "x" }),
    report({ applicationName: "Ghostty", windowTitle: 42 }),
    report({ applicationName: "Ghostty", iconHash: "nothex" }),
    report({ applicationName: "Ghostty", iconObjectKey: KEY }),
    report({ applicationName: "Ghostty", iconHash: HASH, iconObjectKey: "x.svg" }),
    report(desktop, NOW + INGEST_FUTURE_SKEW_MS + 1),
    report(desktop, 1.5),
  ]) {
    await assert.rejects(prepareOmarchyReport(body, NOW, bucket([KEY])));
  }
});
