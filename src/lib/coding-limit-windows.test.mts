import assert from "node:assert/strict";
import test from "node:test";

import { busiestLimit, isExtraLimitWindow, limitWindowTitle } from "./coding-limit-windows.ts";
import type { VibeCodingLimit } from "./types.ts";

function limit(
  key: string,
  label: string | null,
  windowMinutes: number,
  usedPercent: number,
  resetsAt: number | null = null,
): VibeCodingLimit {
  return { key, label, group: null, windowMinutes, usedPercent, resetsAt };
}

test("紧凑行的最忙窗口算上 Antigravity 的 tertiary，不算 Cursor 其他模型、Spark 和 Fable", () => {
  assert.equal(
    busiestLimit(
      [
        limit("antigravity.primary", "Gemini Weekly", 10_080, 10),
        limit("antigravity.tertiary", "Claude & GPT Weekly", 10_080, 80),
        limit("antigravity.quaternary", "Claude & GPT 5h", 300, 5),
      ],
      0,
    )?.key,
    "antigravity.tertiary",
  );
  assert.equal(isExtraLimitWindow(limit("antigravity.tertiary", "Claude & GPT Weekly", 10_080, 80)), false);
  assert.equal(
    busiestLimit(
      [
        limit("cursor.secondary", "Cursor models", 43_200, 12),
        limit("cursor.tertiary", "Other models", 43_200, 100),
      ],
      0,
    )?.key,
    "cursor.secondary",
  );
  assert.equal(
    busiestLimit(
      [
        limit("codex.secondary", null, 10_080, 20),
        limit("codex-spark-weekly", "Codex Spark Weekly", 10_080, 90),
      ],
      0,
    )?.key,
    "codex.secondary",
  );
  assert.equal(
    busiestLimit(
      [
        limit("weekly_all", null, 10_080, 40),
        limit("claude-weekly-scoped-fable", "Fable only", 10_080, 99),
      ],
      0,
    )?.key,
    "weekly_all",
  );
  assert.equal(busiestLimit([], 0), null);
});

test("过了重置点的窗口按 0 跟还在走的比", () => {
  const now = 2_000_000_000_000;
  const picked = busiestLimit(
    [
      limit("codex.primary", null, 300, 90, now / 1000 - 10),
      limit("codex.secondary", null, 10_080, 10, now / 1000 + 3600),
    ],
    now,
  );
  assert.equal(picked?.key, "codex.secondary");
});

test("窗口名优先用上报的 label，没有就按时长", () => {
  assert.equal(limitWindowTitle({ label: "Gemini Weekly", windowMinutes: 10_080 }), "Gemini Weekly");
  assert.equal(limitWindowTitle({ label: "  ", windowMinutes: 300 }), "5-hour");
  assert.equal(limitWindowTitle({ label: null, windowMinutes: 300 }), "5-hour");
  assert.equal(limitWindowTitle({ label: null, windowMinutes: 10_080 }), "Weekly");
  assert.equal(limitWindowTitle({ label: null, windowMinutes: 43_200 }), "Monthly");
  assert.equal(limitWindowTitle({ label: null, windowMinutes: 44_640 }), "Monthly");
  assert.equal(limitWindowTitle({ label: null, windowMinutes: 20_160 }), "14-day");
  assert.equal(limitWindowTitle({ label: null, windowMinutes: 1440 }), "Daily");
  assert.equal(limitWindowTitle({ label: null, windowMinutes: 90 }), null);
  assert.equal(limitWindowTitle({ label: null, windowMinutes: null }), null);
});
