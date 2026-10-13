import assert from "node:assert/strict";
import test from "node:test";

import { SETTLING_MS } from "@shared/charging-settling";

import { settlingDecision } from "./charging-settling";

test("结构变化立即发布并重启沉淀窗口", () => {
  assert.deepEqual(settlingDecision(true, 100_000, 0), { publish: true, restart: true });
  assert.deepEqual(settlingDecision(true, 100_000, 95_000), { publish: true, restart: true });
});

test("没有锚点不补发", () => {
  assert.deepEqual(settlingDecision(false, 100_000, 0), { publish: false, restart: false });
});

test("沉淀窗口内（含边界）补发，超窗不补", () => {
  assert.deepEqual(settlingDecision(false, 100_000, 100_000 - SETTLING_MS), { publish: true, restart: false });
  assert.deepEqual(settlingDecision(false, 100_000, 100_000 - SETTLING_MS - 1), { publish: false, restart: false });
});

test("锚点比收到时刻还新也按窗口内补发", () => {
  assert.deepEqual(settlingDecision(false, 100_000, 120_000), { publish: true, restart: false });
});
