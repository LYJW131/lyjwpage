import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatClock12,
  formatClock24,
  formatDateTime12,
  formatMonthDay,
  formatMonthDayClock12,
  formatMonthDayClock24,
  formatWeekday,
  utcWallClock,
  zonedWallClock,
} from "./format-time.ts";

const SHANGHAI = "Asia/Shanghai";

const CASES = [
  Date.UTC(2026, 9, 5, 11, 18),
  Date.UTC(2026, 9, 5, 0, 0),
  Date.UTC(2026, 9, 5, 0, 7),
  Date.UTC(2026, 9, 5, 12, 0),
  Date.UTC(2026, 9, 5, 12, 59),
  Date.UTC(2026, 9, 5, 23, 59),
  Date.UTC(2026, 8, 1, 9, 5),
  Date.UTC(2026, 11, 31, 23, 59),
  Date.UTC(2027, 0, 1, 0, 0),
  Date.UTC(2026, 11, 31, 15, 59),
  Date.UTC(2026, 11, 31, 16, 0),
  Date.UTC(2028, 1, 29, 4, 30),
];

const label = (ms: number) => new Date(ms).toISOString();

function assertEngineNeutral(text: string) {
  assert.ok(!text.includes(" at "), text);
  assert.ok(!text.includes("\u202f"), text);
}

test("formatDateTime12 与 UTC 平移后的 en-US 日期时间逐字节一致", () => {
  const reference = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  for (const ms of CASES) {
    const text = formatDateTime12(utcWallClock(ms));
    assert.equal(text, reference.format(ms), label(ms));
    assertEngineNeutral(text);
  }
  assert.equal(formatDateTime12(utcWallClock(Date.UTC(2026, 9, 5, 11, 18))), "Oct 5, 2026, 11:18 AM");
});

test("formatMonthDay 与 en-US 月日一致", () => {
  const reference = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  for (const ms of CASES) assert.equal(formatMonthDay(utcWallClock(ms)), reference.format(ms), label(ms));
  assert.equal(formatMonthDay(utcWallClock(Date.UTC(2026, 8, 1))), "Sep 1");
});

test("formatMonthDayClock12 按时区与 en-US 月日时间一致", () => {
  const reference = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  for (const ms of CASES) {
    const text = formatMonthDayClock12(zonedWallClock(ms, SHANGHAI));
    assert.equal(text, reference.format(ms), label(ms));
    assertEngineNeutral(text);
  }
});

test("formatMonthDayClock24 按时区与 en-US 24 小时制一致，零点写 00 不写 24", () => {
  const reference = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  for (const ms of CASES) {
    const text = formatMonthDayClock24(zonedWallClock(ms, SHANGHAI));
    assert.equal(text, reference.format(ms), label(ms));
    assertEngineNeutral(text);
  }
  assert.equal(formatMonthDayClock24(zonedWallClock(Date.UTC(2026, 9, 5, 16, 5), SHANGHAI)), "Oct 6, 00:05");
});

test("时钟与星期与 en-US 一致", () => {
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI, hour: "numeric", minute: "2-digit" });
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI, weekday: "short" });
  for (const ms of CASES) {
    const at = zonedWallClock(ms, SHANGHAI);
    assert.equal(formatClock12(at), clock.format(ms), label(ms));
    assert.equal(formatWeekday(at), weekday.format(ms), label(ms));
  }
  assert.equal(formatClock12(utcWallClock(Date.UTC(2026, 9, 5, 0, 7))), "12:07 AM");
  assert.equal(formatClock12(utcWallClock(Date.UTC(2026, 9, 5, 12, 0))), "12:00 PM");
  assert.equal(formatClock24(utcWallClock(Date.UTC(2026, 9, 5, 9, 5))), "09:05");
});

test("zonedWallClock 跨年按时区换算", () => {
  const at = zonedWallClock(Date.UTC(2026, 11, 31, 16, 0), SHANGHAI);
  assert.deepEqual([at.year, at.month, at.day, at.hour, at.minute], [2027, 1, 1, 0, 0]);
});
