import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRelativeTime } from "./relative-time.ts";

test("相对时间按 GitHub 的档位：分钟、小时、天、周，超过一个月给绝对日期（站点时区 UTC+8）", () => {
  const now = Date.parse("2026-09-12T18:30:00Z");
  const ago = (ms: number) => formatRelativeTime(now - ms, now);
  assert.equal(ago(20_000), "just now");
  assert.equal(ago(13 * 60_000), "13 minutes ago");
  assert.equal(ago(1 * 60_000), "1 minute ago");
  assert.equal(ago(2 * 3_600_000), "2 hours ago");
  assert.equal(ago(1 * 86_400_000), "yesterday");
  assert.equal(ago(3 * 86_400_000), "3 days ago");
  assert.equal(ago(8 * 86_400_000), "last week");
  assert.equal(ago(40 * 86_400_000), "last month");
  assert.equal(ago(400 * 86_400_000), "on Aug 9, 2025");
});

test("older than a month but within a year reads in months", () => {
  const now = Date.UTC(2026, 9, 23, 12);
  assert.equal(formatRelativeTime(now - 65 * 86_400_000, now), "2 months ago");
  assert.equal(formatRelativeTime(now - 200 * 86_400_000, now), "6 months ago");
});
