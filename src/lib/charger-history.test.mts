import assert from "node:assert/strict";
import test from "node:test";

import { CHARGER_HISTORY_LIMIT } from "@shared/limits";
import type { ChargerPayload, ChargerSample } from "@shared/types";
import { historyCursor, mergeChargerHistory, seedChargerHistory } from "./charger-history.ts";

const payload = (history: ChargerSample[], historyPartial: boolean): ChargerPayload => ({
  connected: true,
  totalPower: 0,
  maxPower: 0,
  ports: [],
  device: { firmwareVersion: null, model: null },
  cover: null,
  updatedAt: null,
  history,
  historyPartial,
  pushedAt: 0,
  staleAfterMs: 0,
  lastSeenAt: 0,
  declaredOffline: false,
  heartbeatWindowMs: 0,
});

const reset = () => mergeChargerHistory(payload([], false));

test("游标是最后一个样本的时刻，空历史没有游标", () => {
  reset();
  assert.equal(historyCursor(), null);
  mergeChargerHistory(payload([{ t: 1, w: 5 }, { t: 2, w: 6 }], false));
  assert.equal(historyCursor(), 2);
});

test("seed 只在本地历史为空且载荷是完整快照时落种", () => {
  reset();
  seedChargerHistory(payload([{ t: 3, w: 1 }], true));
  assert.equal(historyCursor(), null);
  seedChargerHistory(payload([{ t: 1, w: 5 }, { t: 2, w: 6 }], false));
  assert.equal(historyCursor(), 2);
  seedChargerHistory(payload([{ t: 9, w: 9 }], false));
  assert.equal(historyCursor(), 2);
});

test("增量历史接到已有序列尾巴上，空的增量不清空已有", () => {
  reset();
  mergeChargerHistory(payload([{ t: 1, w: 5 }], false));
  const merged = mergeChargerHistory(payload([{ t: 2, w: 7 }], true));
  assert.deepEqual(merged.history, [{ t: 1, w: 5 }, { t: 2, w: 7 }]);
  const emptied = mergeChargerHistory(payload([], true));
  assert.deepEqual(emptied.history, [{ t: 1, w: 5 }, { t: 2, w: 7 }]);
});

test("完整快照整份替换本地历史", () => {
  reset();
  mergeChargerHistory(payload([{ t: 1, w: 5 }], false));
  const replaced = mergeChargerHistory(payload([{ t: 9, w: 9 }], false));
  assert.deepEqual(replaced.history, [{ t: 9, w: 9 }]);
  assert.equal(historyCursor(), 9);
});

test(`历史只留最后 ${CHARGER_HISTORY_LIMIT} 条，多的从头上丢`, () => {
  reset();
  const many = Array.from({ length: CHARGER_HISTORY_LIMIT + 10 }, (_, i) => ({ t: i + 1, w: i }));
  const merged = mergeChargerHistory(payload(many, false));
  assert.equal(merged.history.length, CHARGER_HISTORY_LIMIT);
  assert.equal(merged.history[0].t, 11);
  assert.equal(historyCursor(), CHARGER_HISTORY_LIMIT + 10);
});
