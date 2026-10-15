import assert from "node:assert/strict";
import { test } from "node:test";

import { clockLabel, dayTurn, dialBootScript, HAND_INNER, HAND_OUTER, polar } from "./digest-dial.ts";

const TIMEZONE = "Asia/Shanghai";
const OFFSET_SECONDS = 8 * 3600;

function runBootScript(now: number, timezone: string) {
  const clock = { textContent: "" };
  const hand: Record<string, string> = {};
  const dial = {
    querySelector: (selector: string) => selector === "[data-dial-clock]" ? clock
      : selector === "[data-dial-hand]" ? { setAttribute: (name: string, value: string) => { hand[name] = value; } }
      : null,
  };
  const FixedDate = class extends Date { constructor() { super(now); } };
  new Function("document", "Date", dialBootScript(timezone))({ currentScript: { previousElementSibling: dial } }, FixedDate);
  return { clock: clock.textContent, hand };
}

test("内联脚本改写的时刻与指针和服务端渲染逐字一致（catch{} 会吞掉漂移，只能靠这里发现）", () => {
  for (const now of [Date.UTC(2026, 9, 15, 4, 39, 26), Date.UTC(2026, 9, 14, 16, 0, 0), Date.UTC(2026, 9, 15, 15, 59, 59)]) {
    const turn = dayTurn(now, OFFSET_SECONDS);
    const [x1, y1] = polar(HAND_INNER, turn);
    const [x2, y2] = polar(HAND_OUTER, turn);
    assert.deepEqual(runBootScript(now, TIMEZONE), {
      clock: clockLabel(now, TIMEZONE),
      hand: { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) },
    });
  }
});

test("时区名进脚本时转义小于号", () => {
  const script = dialBootScript("</script><script>alert(1)</script>");
  assert.ok(!script.toLowerCase().includes("</script"));
  assert.doesNotThrow(() => new Function(script));
});
