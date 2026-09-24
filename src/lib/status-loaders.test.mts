import assert from "node:assert/strict";
import test from "node:test";

import { statusLoaders } from "./status-loaders.ts";
import {
  STATUS_VIEWS,
  STATUS_VIEW_KEYS,
  endpointViews,
  readModelPolicyOf,
  READ_MODEL_PATHS,
  type StatusView,
} from "./status-views.ts";

test("loaders 与登记表 key 对齐（除 lyrics）", () => {
  assert.deepEqual(
    Object.keys(statusLoaders).sort(),
    STATUS_VIEW_KEYS.filter((key) => key !== "lyrics").sort(),
  );
});

test("有端点且没有 home 覆盖的视图，首页字段与无参端点共用同一个 loader", () => {
  const homeOverrides = new Set(["charger", "trophies"]);
  for (const [key] of endpointViews()) {
    const loader = statusLoaders[key];
    assert.equal(typeof loader.endpoint, "function", key);
    if (homeOverrides.has(key)) {
      assert.ok("home" in loader && typeof loader.home === "function", `${key} 应有 home 覆盖`);
    } else {
      assert.equal("home" in loader, false, `${key} 不应有 home 覆盖`);
    }
  }
  assert.equal("endpoint" in statusLoaders.timezone, false);
  assert.equal(typeof statusLoaders.timezone.home, "function");
});

test("readModel 视图都没有推送事件", () => {
  for (const key of STATUS_VIEW_KEYS) {
    const view: StatusView = STATUS_VIEWS[key];
    if (view.readModel) {
      assert.equal(view.event, undefined, key);
      assert.ok(view.path, key);
      assert.equal(readModelPolicyOf(view.path), "slow", key);
    }
  }
  assert.deepEqual([...READ_MODEL_PATHS].sort(), [
    "/api/status/github-chart",
    "/api/status/github-repo",
    "/api/status/reporters",
    "/api/status/vercel-deployments",
    "/api/status/vibecoding/year",
  ]);
});
