import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_STATUS_URLS,
  collectAgentStatus,
} from "./agent-status-parse.ts";
import { pages, row, typesafeIndex } from "./testing/agent-status-pages.ts";

test("TypeSafe 全部 resolved 就是 Operational，组件照列", async () => {
  const payload = await collectAgentStatus(null, pages());
  const typesafe = row(payload, "typesafe");
  assert.equal(typesafe.indicator, "operational");
  assert.equal(typesafe.incidents.length, 0);
  assert.deepEqual(
    typesafe.components.map((component) => component.name),
    ["api.typesafe.ai", "console.typesafe.ai"],
  );
});

test("TypeSafe 未结束的报告点灯，正文取最新一条更新", async () => {
  const payload = await collectAgentStatus(
    null,
    pages({ [AGENT_STATUS_URLS.typesafe]: typesafeIndex({ page: "downtime", report: "downtime" }) }),
  );
  const typesafe = row(payload, "typesafe");
  assert.equal(typesafe.indicator, "major_outage");
  assert.equal(typesafe.incidents.length, 1);
  assert.equal(typesafe.incidents[0]?.status, "Downtime");
  assert.equal(typesafe.incidents[0]?.url, "https://status.typesafe.ai/incident/1070670");
  assert.equal(typesafe.incidents[0]?.body, "We are actively investigating.");
  assert.equal(typesafe.incidents[0]?.updatedAt, "2026-09-21T23:50:00.000Z");
});

test("TypeSafe 还没开始的维护列出来但不点灯", async () => {
  const payload = await collectAgentStatus(
    null,
    pages({
      [AGENT_STATUS_URLS.typesafe]: typesafeIndex({ report: "maintenance", startsAt: "2026-09-30T00:00:00.000Z" }),
    }),
    Date.parse("2026-09-23T00:00:00.000Z"),
  );
  const typesafe = row(payload, "typesafe");
  assert.equal(typesafe.indicator, "operational");
  assert.equal(typesafe.incidents[0]?.status, "Scheduled");
});
