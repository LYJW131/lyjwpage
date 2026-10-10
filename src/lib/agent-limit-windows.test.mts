import assert from "node:assert/strict";
import test from "node:test";

import { accountWindowSlot, busiestAccountWindow, isExtraAccountWindow } from "./agent-limit-windows.ts";
import type { VibeCodingLimit } from "./types.ts";

function limit(partial: Partial<VibeCodingLimit> & Pick<VibeCodingLimit, "key" | "usedPercent">): VibeCodingLimit {
  return { label: null, group: null, windowMinutes: null, resetsAt: null, ...partial };
}

test("antigravity.tertiary 是另一套周额度，槽位叫 tertiary 也不算 Spark，用量更高时它就是紧凑行那一扇", () => {
  const gemini = limit({
    key: "antigravity.primary",
    label: "Gemini Weekly",
    windowMinutes: 10_080,
    usedPercent: 4,
  });
  const thirdParty = limit({
    key: "antigravity.tertiary",
    label: "Claude & GPT Weekly",
    windowMinutes: 10_080,
    usedPercent: 82,
  });
  assert.equal(isExtraAccountWindow(thirdParty), false);
  assert.equal(accountWindowSlot(thirdParty), "weekly");
  assert.equal(busiestAccountWindow([gemini, thirdParty], 1_000), thirdParty);
});

test("cursor.tertiary 是其他模型的月额度，不因 key 后缀被当成专项窗口", () => {
  const other = limit({
    key: "cursor.tertiary",
    label: "Other models",
    windowMinutes: 43_200,
    usedPercent: 100,
  });
  assert.equal(isExtraAccountWindow(other), false);
  assert.equal(accountWindowSlot(other), "weekly");
});

test("Spark、BengalFox、Fable 和 weekly-scoped 仍不参与紧凑行", () => {
  const session = limit({ key: "codex.primary", windowMinutes: 300, usedPercent: 10 });
  const spark = limit({ key: "codex-spark-session", label: "Codex Spark 5h", windowMinutes: 300, usedPercent: 99 });
  const fox = limit({ key: "codex.secondary", label: "BengalFox weekly", windowMinutes: 10_080, usedPercent: 70 });
  const fable = limit({ key: "claude-weekly-scoped-fable", label: "Fable only", windowMinutes: 10_080, usedPercent: 90 });
  const scoped = limit({ key: "claude-weekly-scoped-opus", label: "Opus only", windowMinutes: 10_080, usedPercent: 88 });
  assert.equal(isExtraAccountWindow(spark), true);
  assert.equal(isExtraAccountWindow(fox), true);
  assert.equal(isExtraAccountWindow(fable), true);
  assert.equal(isExtraAccountWindow(scoped), true);
  assert.equal(accountWindowSlot(spark), null);
  assert.equal(busiestAccountWindow([session, spark, fox, fable, scoped], 1_000), session);
});

test("已经过点的窗口按 0 参与，不压过另一扇还有用量的", () => {
  const expired = limit({ key: "codex.primary", windowMinutes: 300, usedPercent: 80, resetsAt: 1 });
  const weekly = limit({ key: "codex.secondary", windowMinutes: 10_080, usedPercent: 12, resetsAt: 9_999_999 });
  assert.equal(busiestAccountWindow([expired, weekly], 2_000), weekly);
});
