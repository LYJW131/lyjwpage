import assert from "node:assert/strict";
import test from "node:test";

import { CRON_MONITOR_CONFIG, heartbeatDue } from "./cron-heartbeat.ts";

test("cron 每分钟跑，心跳只在整 5 分钟那一轮报，和监控的 crontab 对齐", () => {
  const at = (iso: string) => Date.parse(iso);
  assert.equal(heartbeatDue(at("2026-09-25T03:00:00Z")), true);
  assert.equal(heartbeatDue(at("2026-09-25T03:05:00Z")), true);
  assert.equal(heartbeatDue(at("2026-09-25T03:01:00Z")), false);
  assert.equal(heartbeatDue(at("2026-09-25T03:59:00Z")), false);
  // 触发时刻偶尔晚几秒，仍按所在的那一分钟算
  assert.equal(heartbeatDue(at("2026-09-25T03:10:07Z")), true);
  assert.equal(CRON_MONITOR_CONFIG.schedule.value, "*/5 * * * *");
});
