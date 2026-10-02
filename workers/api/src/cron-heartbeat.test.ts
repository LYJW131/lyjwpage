import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CRON_HEARTBEAT_EVERY_MINUTES } from "@/lib/sentry";
import { CRON_MONITOR_CONFIG, CRON_SCHEDULE } from "./cron-heartbeat.ts";
import { PULSE_SCORE_LEASE_MS } from "./pulse-score-state.ts";

test("cron 每 5 分钟一轮、落在评分余量之后，wrangler 触发器与监控 crontab 同一份", () => {
  assert.equal(CRON_SCHEDULE, "2,7,12,17,22,27,32,37,42,47,52,57 * * * *");
  assert.equal(CRON_MONITOR_CONFIG.schedule.value, CRON_SCHEDULE);
  const toml = readFileSync(`${dirname(fileURLToPath(import.meta.url))}/../wrangler.toml`, "utf8");
  assert.match(toml, new RegExp(`^crons = \\["${CRON_SCHEDULE.replaceAll("*", "\\*")}"\\]$`, "m"));
});

test("空转不交还的评分租约在下一轮 cron 之前过期", () => {
  assert.ok(PULSE_SCORE_LEASE_MS < CRON_HEARTBEAT_EVERY_MINUTES * 60_000);
});
