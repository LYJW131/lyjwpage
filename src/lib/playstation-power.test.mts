import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePlaystationPower } from "../../shared/playstation.ts";

test("HA 送来的电源状态：on 必填，observedAt 缺席按落地时刻算", () => {
  const now = Date.parse("2026-09-13T14:00:00Z");

  assert.deepEqual(
    normalizePlaystationPower({ on: true, observedAt: 123, entityId: "switch.ps5_210_power" }, now),
    { on: true, observedAt: 123, entityId: "switch.ps5_210_power" },
  );

  // HA 模板里取当前时间要绕一圈，不强求；这条上报是事件驱动的，落地即观测
  assert.deepEqual(normalizePlaystationPower({ on: false }, now), {
    on: false,
    observedAt: now,
    entityId: null,
  });

  // 0 / 负数 / 非数字都当没给，别让一个坏时间戳永远「早于上一轮」
  assert.equal(normalizePlaystationPower({ on: true, observedAt: 0 }, now).observedAt, now);
  assert.equal(normalizePlaystationPower({ on: true, observedAt: -1 }, now).observedAt, now);
  assert.equal(normalizePlaystationPower({ on: true, observedAt: "早上" }, now).observedAt, now);
});

test("on 不是布尔值就拒收，不猜", () => {
  // "on" / "off" 是 HA 实体的字符串状态，自动化里必须先翻译成布尔值再发
  assert.throws(() => normalizePlaystationPower({ on: "on" }), /on 必须是布尔值/);
  assert.throws(() => normalizePlaystationPower({}), /on 必须是布尔值/);
  assert.throws(() => normalizePlaystationPower(null), /必须是对象/);
});
