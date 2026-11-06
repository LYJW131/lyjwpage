import assert from "node:assert/strict";
import test from "node:test";

import { INGEST_FUTURE_SKEW_MS } from "@shared/freshness";
import { prepareOmarchyReport } from "@shared/ingest/omarchy";

const NOW = Date.parse("2026-11-06T04:00:00Z");

function report(desktop: unknown, observedAt = NOW - 1_000) {
  return { version: 1, observedAt, modules: { desktop } };
}

test("omarchy：前台窗口照收，空白字段归 null，标题按码点截到 200", () => {
  const prepared = prepareOmarchyReport(report({
    applicationName: " Ghostty ", appId: "com.mitchellh.ghostty", windowTitle: "😀".repeat(300), workspace: "  ",
  }), NOW);
  assert.equal(prepared.source, "omarchy");
  assert.deepEqual({ ...prepared.presence.desktop, windowTitle: undefined }, {
    applicationName: "Ghostty", appId: "com.mitchellh.ghostty", windowTitle: undefined, workspace: null,
  });
  assert.equal([...prepared.presence.desktop!.windowTitle!].length, 200);
  assert.equal(prepared.presence.receivedAt, NOW);
});

test("omarchy：没有聚焦窗口时 desktop 为 null", () => {
  assert.equal(prepareOmarchyReport(report(null), NOW).presence.desktop, null);
});

test("omarchy：信封不对、缺 applicationName、时间超前都拒收", () => {
  const desktop = { applicationName: "Ghostty" };
  for (const body of [
    { ...report(desktop), version: 2 },
    { version: 1, observedAt: NOW, modules: {} },
    report({ appId: "x" }),
    report({ applicationName: "Ghostty", windowTitle: 42 }),
    report(desktop, NOW + INGEST_FUTURE_SKEW_MS + 1),
    report(desktop, 1.5),
  ]) {
    assert.throws(() => prepareOmarchyReport(body, NOW));
  }
});
