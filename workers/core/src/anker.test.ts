import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { heartbeatWindowMs } from "@shared/freshness";
import type { ChargerPayload, ChargerSample, ReportedChargerStatus } from "@shared/types";
import type { Liveness } from "@shared/reporter-liveness";
import { chargerPushPayload, chargerStaleAfterMs, sliceChargerHistory } from "./anker";

const NOW = 1_800_000_000_000;

function withEnv(t: TestContext, name: string, value: string | undefined): void {
  const previous = process.env[name];
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function reportedStatus(extra: Partial<ReportedChargerStatus> = {}): ReportedChargerStatus {
  return {
    connected: true,
    totalPower: 40,
    maxPower: 140,
    ports: [],
    device: { firmwareVersion: "v0.0.5.2", model: "A2687", serialNumber: "ASHDJW7CF49200487" },
    cover: null,
    updatedAt: NOW,
    ...extra,
  };
}

function payload(history: ChargerSample[]): ChargerPayload {
  return {
    ...reportedStatus(),
    history,
    historyPartial: false,
    pushedAt: NOW,
    staleAfterMs: 0,
    lastSeenAt: 0,
    declaredOffline: false,
    heartbeatWindowMs: 0,
  };
}

const LIVE: Liveness = { lastSeenAt: NOW - 1_000, declaredOffline: false };

test("断流窗口取阈值、三倍上报间隔与心跳窗口里的最大者", (t) => {
  withEnv(t, "CHARGER_PUSH_INTERVAL_MS", undefined);
  withEnv(t, "HEARTBEAT_WINDOW_MS", undefined);
  assert.equal(chargerStaleAfterMs(), 300_000);

  process.env.CHARGER_PUSH_INTERVAL_MS = "200000";
  assert.equal(chargerStaleAfterMs(), 600_000);

  process.env.CHARGER_PUSH_INTERVAL_MS = "not-a-number";
  assert.equal(chargerStaleAfterMs(), 300_000);
});

test("心跳窗口调大时断流窗口跟着放大", (t) => {
  withEnv(t, "CHARGER_PUSH_INTERVAL_MS", undefined);
  withEnv(t, "HEARTBEAT_WINDOW_MS", "600000");
  assert.equal(chargerStaleAfterMs(), 600_000);
});

test("游标早于保留区间回全量，之后的只回增量", () => {
  const history = [{ t: 100, w: 10 }, { t: 200, w: 20 }, { t: 300, w: 30 }];
  assert.deepEqual(sliceChargerHistory(payload(history)), {
    ...payload(history),
    historyPartial: false,
  });
  assert.deepEqual(sliceChargerHistory(payload(history), 50).history, history);
  assert.equal(sliceChargerHistory(payload(history), 50).historyPartial, false);

  assert.deepEqual(sliceChargerHistory(payload(history), 100).history, [{ t: 200, w: 20 }, { t: 300, w: 30 }]);
  assert.equal(sliceChargerHistory(payload(history), 100).historyPartial, true);
  assert.deepEqual(sliceChargerHistory(payload(history), 250).history, [{ t: 300, w: 30 }]);
  assert.deepEqual(sliceChargerHistory(payload(history), 300).history, []);
  assert.equal(sliceChargerHistory(payload(history), 300).historyPartial, true);
});

test("空历史没有游标语义，一律全量", () => {
  assert.equal(sliceChargerHistory(payload([]), 100).historyPartial, false);
  assert.deepEqual(sliceChargerHistory(payload([]), 100).history, []);
});

test("推送载荷：序列号不外发，封面只认 R2 对象键，historyPartial 看库存读数", () => {
  const pushed = chargerPushPayload({ status: reportedStatus(), receivedAt: NOW, historyCount: 3, liveness: LIVE });
  assert.equal(pushed.pushedAt, NOW);
  assert.equal(pushed.historyPartial, true);
  assert.deepEqual(pushed.history, []);
  assert.deepEqual(pushed.device, { firmwareVersion: "v0.0.5.2", model: "A2687" });
  assert.equal("serialNumber" in pushed.device, false);
  assert.equal(pushed.lastSeenAt, LIVE.lastSeenAt);
  assert.equal(pushed.declaredOffline, false);
  assert.equal(pushed.heartbeatWindowMs, heartbeatWindowMs());

  const covered = chargerPushPayload({
    status: reportedStatus({
      cover: { name: "Baseus", iconHash: "hash", iconObjectKey: "deadbeef.png", iconUrl: "https://stale.example/icon.png" },
    }),
    receivedAt: NOW,
    historyCount: 0,
    liveness: LIVE,
  });
  assert.equal(covered.historyPartial, false);
  assert.equal(covered.cover?.iconUrl, "/img/deadbeef.png");

  const noObjectKey = chargerPushPayload({
    status: reportedStatus({
      cover: { name: "Baseus", iconHash: "hash", iconObjectKey: null, iconUrl: "https://stale.example/icon.png" },
    }),
    receivedAt: NOW,
    historyCount: 0,
    liveness: LIVE,
  });
  assert.equal(noObjectKey.cover?.iconUrl, null);
});
