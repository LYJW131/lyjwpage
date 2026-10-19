import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_STATUS_URLS,
  collectAgentStatus,
  parseAppleStatus,
} from "./agent-status-parse.ts";
import { appleStatus, pages, row } from "./testing/agent-status-pages.ts";

const appleOngoing = {
  statusType: "Outage",
  eventStatus: "ongoing",
  startDate: "09/22/2026 08:00 PDT",
  endDate: null,
  usersAffected: "Some users are affected",
  message: "Users are experiencing a problem with this service.",
};

test("Apple 只列我们用到的服务，全都没事就是 Operational", async () => {
  const parsed = parseAppleStatus(appleStatus());
  assert.equal(parsed.services.length, 4);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0]?.eventStatus, "resolved");

  const payload = await collectAgentStatus(null, pages());
  const apple = row(payload, "apple");
  assert.equal(apple.indicator, "operational");
  assert.equal(apple.incidents.length, 0);
  assert.deepEqual(apple.components, [
    { name: "Apple Music API", indicator: "operational" },
    { name: "Developer ID Notary Service", indicator: "operational" },
  ]);
});

test("Apple 没用到的服务出事不点这一行", async () => {
  const payload = await collectAgentStatus(
    null,
    pages({ [AGENT_STATUS_URLS.apple]: appleStatus([], [{ ...appleOngoing, usersAffected: "All users are affected" }]) }),
  );
  const apple = row(payload, "apple");
  assert.equal(apple.indicator, "operational");
  assert.equal(apple.incidents.length, 0);
});

test("Apple 状态页不再列出盯着的服务时是 Unavailable，不退回整页", async () => {
  const body = `jsonCallback(${JSON.stringify({
    services: [{ serviceName: "Account", redirectUrl: null, events: [appleOngoing] }],
  })});`;
  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.apple]: body }));
  const apple = row(payload, "apple");
  assert.equal(apple.indicator, "unavailable");
  assert.match(apple.note ?? "", /no longer lists/);
  assert.equal(apple.incidents.length, 0);
});

test("Apple 进行中的 Outage 按受影响范围分轻重，时间换成 ISO", async () => {
  const ongoing = appleOngoing;
  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.apple]: appleStatus([ongoing]) }));
  const apple = row(payload, "apple");
  assert.equal(apple.indicator, "partial_outage");
  assert.deepEqual(apple.components, [
    { name: "Apple Music API", indicator: "operational" },
    { name: "Developer ID Notary Service", indicator: "partial_outage" },
  ]);
  assert.equal(apple.incidents[0]?.title, "Developer ID Notary Service");
  assert.equal(apple.incidents[0]?.status, "Ongoing");
  assert.equal(apple.incidents[0]?.url, "https://developer.apple.com/notary/");
  assert.equal(apple.incidents[0]?.updatedAt, "2026-09-22T15:00:00.000Z");
  assert.equal(
    apple.incidents[0]?.body,
    "Users are experiencing a problem with this service. Some users are affected.",
  );

  const everyone = await collectAgentStatus(
    null,
    pages({ [AGENT_STATUS_URLS.apple]: appleStatus([{ ...ongoing, usersAffected: "All users are affected" }]) }),
  );
  assert.equal(row(everyone, "apple").indicator, "major_outage");
});

test("Apple 的状态读不出来时这一行是 Unavailable", async () => {
  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.apple]: "<html>maintenance page</html>" }));
  const apple = row(payload, "apple");
  assert.equal(apple.indicator, "unavailable");
  assert.equal(apple.note, "Status check failed.");
});
