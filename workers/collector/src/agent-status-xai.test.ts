import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_STATUS_URLS,
  collectAgentStatus,
  parseXaiFeed,
  parseXaiServiceBadges,
} from "./agent-status-parse.ts";
import { pages, row, xaiFeed, xaiHome } from "./testing/agent-status-pages.ts";

test("xAI 首页灯是 available，未结束且点名 Grok Build 的事件把它拉成降级", async () => {
  const badges = parseXaiServiceBadges(xaiHome);
  assert.deepEqual(
    badges.map((badge) => [badge.href, badge.badge]),
    [
      ["/grok-com", "available"],
      ["/grok-build", "available"],
      ["/api-us-east-1", "outage"],
    ],
  );
  const items = parseXaiFeed(xaiFeed);
  assert.equal(items[0]?.status, "Identified");
  assert.equal(items[1]?.status, "resolved");

  const payload = await collectAgentStatus(null, pages());
  const grok = row(payload, "grok");
  assert.equal(grok.indicator, "degraded");
  assert.equal(grok.components[0]?.indicator, "operational");
  assert.equal(grok.incidents.length, 1);
  assert.match(grok.incidents[0]?.title ?? "", /Grok Build/);
  assert.equal(grok.incidents[0]?.body, "We are investigating a datacenter issue.");
});

test("首页被拦时，feed 里没有未结束的 Grok Build 事件就按正常", async () => {
  const feed = xaiFeed
    .replace("<category>disruption</category>", "<category>disruption</category><category>resolved</category>")
    .replace("Status: IDENTIFIED", "Status: RESOLVED");
  const payload = await collectAgentStatus(null, pages({
    [AGENT_STATUS_URLS.xaiHome]: new Error("403 status.x.ai"),
    [AGENT_STATUS_URLS.xaiFeed]: feed,
  }));
  const grok = row(payload, "grok");
  assert.equal(grok.indicator, "operational");
  assert.equal(grok.incidents.length, 0);
  assert.equal(grok.note, null);
  assert.equal(grok.stale, false);
});

test("Grok Build 自己的灯是 outage 时，已解决的 feed 不把它刷回正常", async () => {
  const home = xaiHome.replace('href="/grok-build"><div class="heading-2">Grok Build</div><div class="text-text-success">available', 'href="/grok-build"><div class="heading-2">Grok Build</div><div class="text-text-danger">outage');
  const feed = xaiFeed.replace("<category>disruption</category>", "<category>disruption</category><category>resolved</category>").replace("Status: IDENTIFIED", "Status: RESOLVED");
  const payload = await collectAgentStatus(null, pages({
    [AGENT_STATUS_URLS.xaiHome]: home,
    [AGENT_STATUS_URLS.xaiFeed]: feed,
  }));
  const grok = row(payload, "grok");
  assert.equal(grok.indicator, "major_outage");
  assert.equal(grok.incidents.length, 0);
});

test("HTML 实体只解一层，双重编码不会再被解开", () => {
  const feed = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Grok Build</title>
    <link>https://status.x.ai/grok-build/INC3</link>
    <guid>INC3</guid>
    <category>disruption</category>
    <description><![CDATA[
      <h3>Status: IDENTIFIED</h3>
      <p>Severity: disruption</p>
      <h3>Update</h3>
      <p>Tom &amp;amp; Jerry saw &amp;lt;build&amp;gt; &#39;ok&#39; &#x26;lt;script&amp;gt;</p>
    ]]></description>
  </item>
</channel></rss>`;
  const items = parseXaiFeed(feed);
  assert.equal(items[0]?.body, "Tom &amp; Jerry saw &lt;build&gt; 'ok' &lt;script&gt;");
});
