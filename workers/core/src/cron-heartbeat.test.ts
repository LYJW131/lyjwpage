import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CRON_SCHEDULE, cronSlot } from "./cron-heartbeat.ts";

test("每 5 分钟一格，格的起点与心跳计数同一份时刻表", () => {
  assert.equal(CRON_SCHEDULE, "2,7,12,17,22,27,32,37,42,47,52,57 * * * *");
  const hour = Date.UTC(2026, 9, 13, 18);
  const starts = new Set(Array.from({ length: 60 }, (_, minute) => (cronSlot(hour + minute * 60_000 + 48_000) - hour) / 60_000));
  assert.deepEqual([...starts].filter((minute) => minute >= 0), [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57]);
});

test("这一格的排定分钟没投来时，格内后面的分钟落进同一格", () => {
  const hour = Date.UTC(2026, 9, 26, 3);
  const slot = hour + 12 * 60_000;
  for (const minute of [12, 13, 14, 15, 16]) assert.equal(cronSlot(hour + minute * 60_000 + 29_861), slot);
  assert.equal(cronSlot(hour + 17 * 60_000), slot + 5 * 60_000);
  assert.equal(cronSlot(hour + 11 * 60_000 + 59_999), slot - 5 * 60_000);
});

test("core 不挂 Cloudflare cron，由采集 Worker 驱动，免得每轮跑两次", () => {
  const toml = readFileSync(`${dirname(fileURLToPath(import.meta.url))}/../wrangler.toml`, "utf8");
  assert.match(toml, /^crons = \[\]$/m);
});
