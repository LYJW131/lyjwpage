import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CRON_SCHEDULE, cronRoundDue } from "./cron-heartbeat.ts";

test("每 5 分钟一轮，轮次判定与心跳计数同一份时刻表", () => {
  assert.equal(CRON_SCHEDULE, "2,7,12,17,22,27,32,37,42,47,52,57 * * * *");
  const hour = Date.UTC(2026, 9, 13, 18);
  const due = Array.from({ length: 60 }, (_, minute) => minute).filter((minute) => cronRoundDue(hour + minute * 60_000 + 48_000));
  assert.deepEqual(due, [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57]);
});

test("core 不挂 Cloudflare cron，由采集 Worker 驱动，免得每轮跑两次", () => {
  const toml = readFileSync(`${dirname(fileURLToPath(import.meta.url))}/../wrangler.toml`, "utf8");
  assert.match(toml, /^crons = \[\]$/m);
});
