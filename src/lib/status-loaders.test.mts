import assert from "node:assert/strict";
import test from "node:test";

import { statusLoaders } from "./status-loaders.ts";
import {
  STATUS_VIEWS,
  STATUS_VIEW_KEYS,
  layerOfPath,
  pathByEvent,
  readModelPolicyOf,
  READ_MODEL_PATHS,
  type StatusView,
} from "./status-views.ts";

test("loaders 与登记表 key 一一对应，每个视图一个端点", () => {
  assert.deepEqual(Object.keys(statusLoaders).sort(), [...STATUS_VIEW_KEYS].sort());
  for (const key of STATUS_VIEW_KEYS) {
    assert.equal(typeof statusLoaders[key].endpoint, "function", key);
    assert.ok(STATUS_VIEWS[key].path.startsWith("/api/status/"), key);
  }
});

test("可滞后层不推送，推送事件只落在实时层的端点上", () => {
  for (const key of STATUS_VIEW_KEYS) {
    const view: StatusView = STATUS_VIEWS[key];
    if (view.layer === "lag") assert.equal(view.event, undefined, key);
    if (view.event) assert.equal(layerOfPath(pathByEvent(view.event)!), "realtime", key);
  }
  assert.equal(STATUS_VIEWS.agentStatus.layer, "lag");
  assert.equal(layerOfPath("/api/lyrics"), "realtime");
});

test("readModel 只出现在可滞后层", () => {
  for (const key of STATUS_VIEW_KEYS) {
    const view: StatusView = STATUS_VIEWS[key];
    if (view.readModel) {
      assert.equal(view.layer, "lag", key);
      assert.equal(readModelPolicyOf(view.path), "slow", key);
    }
  }
  assert.deepEqual([...READ_MODEL_PATHS].sort(), [
    "/api/status/github-chart",
    "/api/status/github-repo",
    "/api/status/reporters",
    "/api/status/sentry",
    "/api/status/vercel-deployments",
    "/api/status/vibecoding/year",
  ]);
});
