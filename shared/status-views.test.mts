import assert from "node:assert/strict";
import test from "node:test";

import {
  cadenceOfPath,
  filterStatusTags,
  isPushedViewPath,
  lagViewKeyByPath,
  layerOfPath,
  pathByEvent,
  pushCoversPath,
  viewKeyByPath,
} from "./status-views.ts";

test("路径反查视图键：now 端点是独立视图，未知路径查不到", () => {
  assert.equal(viewKeyByPath("/api/status/listening"), "listening");
  assert.equal(viewKeyByPath("/api/status/listening/now"), "nowListening");
  assert.equal(viewKeyByPath("/api/status/powerbank"), "powerBank");
  assert.equal(viewKeyByPath("/api/status/agent-status"), "agentStatus");
  assert.equal(viewKeyByPath("/api/status/nope"), undefined);
  assert.equal(viewKeyByPath("/api/status"), undefined);
});

test("分层：可滞后视图是 lag，实时与未知路径都归 realtime", () => {
  assert.equal(layerOfPath("/api/status/server"), "lag");
  assert.equal(layerOfPath("/api/status/timezone"), "lag");
  assert.equal(layerOfPath("/api/status/desktop"), "realtime");
  assert.equal(layerOfPath("/api/status/nope"), "realtime");
  assert.equal(lagViewKeyByPath("/api/status/server"), "server");
  assert.equal(lagViewKeyByPath("/api/status/desktop"), undefined);
  assert.equal(lagViewKeyByPath("/api/status/nope"), undefined);
});

test("推送事件反查路径：只有带 event 的视图能被推，可滞后层没有事件", () => {
  assert.equal(pathByEvent("listening-now"), "/api/status/listening/now");
  assert.equal(pathByEvent("desktop"), "/api/status/desktop");
  assert.equal(pathByEvent("quest-now"), "/api/status/quest/now");
  assert.equal(pathByEvent("server"), undefined);
  assert.equal(pathByEvent("timezone"), undefined);
  assert.equal(pathByEvent(""), undefined);
});

test("轮询节奏只来自可滞后层，路径上的查询串不影响识别", () => {
  assert.equal(cadenceOfPath("/api/status/server"), 60_000);
  assert.equal(cadenceOfPath("/api/status/github-chart"), 10 * 60_000);
  assert.equal(cadenceOfPath("/api/status/server?since=1"), 60_000);
  assert.equal(cadenceOfPath("/api/status/desktop"), undefined);
  assert.equal(cadenceOfPath("/api/status/nope"), undefined);
});

test("pushCovers 与推送视图：实时事件视图才成立", () => {
  assert.equal(pushCoversPath("/api/status/trophies"), true);
  assert.equal(pushCoversPath("/api/status/listening"), true);
  assert.equal(pushCoversPath("/api/status/desktop"), false);
  assert.equal(pushCoversPath("/api/status/server"), false);
  assert.equal(isPushedViewPath("/api/status/desktop"), true);
  assert.equal(isPushedViewPath("/api/status/coding/now"), true);
  assert.equal(isPushedViewPath("/api/status/coding"), false);
  assert.equal(isPushedViewPath("/api/status/timezone"), false);
  assert.equal(isPushedViewPath("/api/status/nope"), false);
});

test("filterStatusTags 只留登记过的标签并按序去重", () => {
  assert.deepEqual(filterStatusTags(["desktop", "bogus", "server", "desktop"]), ["desktop", "server"]);
  assert.deepEqual(filterStatusTags([]), []);
  assert.deepEqual(filterStatusTags(["nope", "coding-now"]), ["coding-now"]);
});
