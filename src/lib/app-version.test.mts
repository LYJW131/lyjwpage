import assert from "node:assert/strict";
import test from "node:test";

import { resolveVersionStatus, servingDeployment } from "./app-version.ts";

test("两边 sha 一致就是最新", () => {
  assert.equal(resolveVersionStatus("a".repeat(40), "a".repeat(40)), "current");
});

test("对不上就是旧页面", () => {
  assert.equal(resolveVersionStatus("a".repeat(40), "b".repeat(40)), "stale");
});

test("任一边拿不到都是 unknown，不误报成旧", () => {
  assert.equal(resolveVersionStatus(null, "b".repeat(40)), "unknown");
  assert.equal(resolveVersionStatus("a".repeat(40), null), "unknown");
  assert.equal(resolveVersionStatus(null, null), "unknown");
  assert.equal(resolveVersionStatus("", "b".repeat(40)), "unknown");
  assert.equal(resolveVersionStatus("a".repeat(40), ""), "unknown");
});

const dep = (
  state: string,
  createdAt: number,
  target = "production",
) => ({ state, target, createdAt });

test("正在构建的那一版不算数：targets.production 构建一开始就切过去了", () => {
  const building = dep("BUILDING", 300);
  const ready = dep("READY", 200);
  // 直接用 production 会在部署完成前就判定「有新版本」
  assert.equal(servingDeployment(building, [building, ready]), ready);
});

test("READY 的 production 直接用，回滚到旧版也认它而不是列表里更新的那些", () => {
  const rolledBackTo = dep("READY", 100);
  const newer = dep("READY", 500);
  assert.equal(servingDeployment(rolledBackTo, [newer, rolledBackTo]), rolledBackTo);
});

test("构建中且最近一批里没有 READY 生产部署时给 null，宁可不提示", () => {
  assert.equal(servingDeployment(dep("BUILDING", 300), [dep("ERROR", 200)]), null);
  assert.equal(servingDeployment(dep("BUILDING", 300), []), null);
  assert.equal(servingDeployment(null, undefined), null);
});

test("预览部署不参与：只有 target 是 production 的才可能在服务", () => {
  const preview = dep("READY", 900, "preview");
  const production = dep("READY", 100);
  assert.equal(servingDeployment(dep("QUEUED", 950), [preview, production]), production);
});
