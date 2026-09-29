import assert from "node:assert/strict";
import test from "node:test";

import { shouldAutoReload, type AutoReloadInput, resolveVersionStatus } from "./app-version.ts";

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

const NEW = "b".repeat(40);
const base: AutoReloadInput = {
  status: "stale",
  latestCommit: NEW,
  trigger: "background",
  hidden: true,
  playerBusy: false,
  reloadedFor: null,
  storageUsable: true,
};

test("自动刷新：旧页面在后台就刷", () => {
  assert.equal(shouldAutoReload(base), true);
});

test("自动刷新：后台场景下页面还看得见就不动，交给提示卡", () => {
  assert.equal(shouldAutoReload({ ...base, hidden: false }), false);
});

test("自动刷新：卡片已经崩了且确知页面旧，可见也刷", () => {
  assert.equal(shouldAutoReload({ ...base, trigger: "crash", hidden: false }), true);
});

test("自动刷新：不是确知的旧页面（最新 / unknown）一律不刷", () => {
  assert.equal(shouldAutoReload({ ...base, status: "current" }), false);
  assert.equal(shouldAutoReload({ ...base, status: "unknown" }), false);
  assert.equal(shouldAutoReload({ ...base, status: "unknown", trigger: "crash", hidden: false }), false);
  assert.equal(shouldAutoReload({ ...base, latestCommit: null }), false);
});

test("自动刷新：同一个目标 sha 只刷一次，边缘 HTML 还是旧的也不循环", () => {
  assert.equal(shouldAutoReload({ ...base, reloadedFor: NEW }), false);
  assert.equal(shouldAutoReload({ ...base, trigger: "crash", hidden: false, reloadedFor: NEW }), false);
});

test("自动刷新：又有新部署（目标 sha 变了）就再刷一次", () => {
  assert.equal(shouldAutoReload({ ...base, reloadedFor: "c".repeat(40) }), true);
});

test("自动刷新：播放器在放或在同步就不刷，音乐比一张旧卡贵", () => {
  assert.equal(shouldAutoReload({ ...base, playerBusy: true }), false);
  assert.equal(shouldAutoReload({ ...base, trigger: "crash", hidden: false, playerBusy: true }), false);
});

test("自动刷新：记不住「刷过了」就不刷，宁可不修也不冒循环的险", () => {
  assert.equal(shouldAutoReload({ ...base, storageUsable: false }), false);
  assert.equal(shouldAutoReload({ ...base, trigger: "crash", hidden: false, storageUsable: false }), false);
});
