import assert from "node:assert/strict";
import test from "node:test";

import {
  CONNECTION_CLOSE_MS,
  CONNECTION_STALE_MS,
  VISIBLE_STALE_MS,
  parseVisibility,
  readMark,
  takeCensus,
  type SocketSample,
} from "./live-census.ts";

const NOW = 10_000_000;

function sample(socket: string, { pinged = null, at = NOW, visible = false, seenAt = at, relay = false }: {
  pinged?: number | null; at?: number; visible?: boolean; seenAt?: number; relay?: boolean;
} = {}): SocketSample<string> {
  return { socket, pinged, mark: { at, visible, seenAt, relay } };
}

test("可见页面同时计入两个数，后台页面只算开着", () => {
  const census = takeCensus([
    sample("front", { pinged: NOW - 10_000, visible: true }),
    sample("back", { pinged: NOW - 10_000 }),
  ], NOW);
  assert.deepEqual(census, { connections: 2, online: 1, watched: true, expired: [] });
});

test("可见连接静默超过三个心跳就不算可见，但仍算开着", () => {
  const silent = NOW - VISIBLE_STALE_MS - 1;
  const census = takeCensus([sample("ghost", { at: silent, pinged: silent, visible: true })], NOW);
  assert.deepEqual(census, { connections: 1, online: 0, watched: false, expired: [] });
});

test("刚切回可见的节流标签页：切换消息本身算它活着", () => {
  const throttledPing = NOW - 4 * 60_000;
  const census = takeCensus([sample("back-then-front", { at: NOW - 3_600_000, pinged: throttledPing, visible: true, seenAt: NOW - 1_000 })], NOW);
  assert.equal(census.online, 1);
});

test("静默 5 分钟不计数，30 分钟才关", () => {
  const census = takeCensus([
    sample("stale", { at: NOW - CONNECTION_STALE_MS - 1 }),
    sample("dead", { at: NOW - CONNECTION_CLOSE_MS - 1 }),
  ], NOW);
  assert.deepEqual(census, { connections: 0, online: 0, watched: false, expired: ["dead"] });
});

test("没有 attachment、也没 ping 过的旧连接：不计数、直接关", () => {
  assert.deepEqual(takeCensus([{ socket: "legacy", pinged: null, mark: null }], NOW), { connections: 0, online: 0, watched: false, expired: ["legacy"] });
});

test("时钟往回跳时宁可多数一个人", () => {
  assert.equal(takeCensus([sample("future", { at: NOW + 60_000, visible: true })], NOW).online, 1);
});

test("旧部署的 attachment 只有 at：按不可见读", () => {
  assert.deepEqual(readMark({ at: 5 }), { at: 5, visible: false, seenAt: 5, relay: false });
  assert.equal(readMark(null), null);
  assert.deepEqual(readMark(null, 7), { at: 7, visible: false, seenAt: 7, relay: false });
  assert.equal(readMark({ at: 5, relay: true })?.relay, true);
});

test("只剩后台页面时没人在看；任一可见页面就算有人", () => {
  assert.equal(takeCensus([sample("back", { pinged: NOW - 10_000 })], NOW).watched, false);
  assert.equal(takeCensus([], NOW).watched, false);
  assert.equal(takeCensus([
    sample("back", { pinged: NOW - 10_000 }),
    sample("front", { pinged: NOW - 10_000, visible: true }),
  ], NOW).watched, true);
});

test("本地中继算有人在看，但不进在线人数；中继静默过久就不算", () => {
  const live = takeCensus([sample("relay", { pinged: NOW - 10_000, relay: true })], NOW);
  assert.deepEqual(live, { connections: 1, online: 0, watched: true, expired: [] });
  const silent = NOW - CONNECTION_STALE_MS - 1;
  assert.equal(takeCensus([sample("relay", { at: silent, pinged: silent, relay: true })], NOW).watched, false);
});

test("只认 visible / hidden 两条消息", () => {
  assert.equal(parseVisibility("visible"), true);
  assert.equal(parseVisibility("hidden"), false);
  for (const other of ["ping", "VISIBLE", "", new ArrayBuffer(1)]) assert.equal(parseVisibility(other), null);
});
