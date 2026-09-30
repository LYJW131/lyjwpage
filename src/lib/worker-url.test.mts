import assert from "node:assert/strict";
import test from "node:test";

import { workerUrl } from "./worker-url.ts";

test("三个 Worker 变量只填源，路径由调用点拼上去", () => {
  assert.equal(workerUrl("https://live.example.com", "/publish"), "https://live.example.com/publish");
  assert.equal(workerUrl("https://api.example.com", "/count"), "https://api.example.com/count");
  assert.equal(workerUrl("https://token.example.com", "/token"), "https://token.example.com/token");
});

test("浏览器要连的 wss 从 https 推出来，端口跟着源走", () => {
  assert.equal(workerUrl("https://live.example.com", "/ws", { websocket: true }), "wss://live.example.com/ws");
  assert.equal(workerUrl("http://127.0.0.1:8787", "/ws", { websocket: true }), "ws://127.0.0.1:8787/ws");
  assert.equal(workerUrl("https://live.example.com:8443", "/ws", { websocket: true }), "wss://live.example.com:8443/ws");
});

test("源上带的路径不参与拼接，避免配成 /ws 之后再拼出 /ws/ws", () => {
  assert.equal(workerUrl("https://live.example.com/", "/ws", { websocket: true }), "wss://live.example.com/ws");
  assert.equal(workerUrl("https://live.example.com/ws", "/publish"), "https://live.example.com/publish");
});

test("没配就是 null —— 对应「这个功能整体停用」，不是抛错也不是兜底地址", () => {
  assert.equal(workerUrl(undefined, "/ws"), null);
  assert.equal(workerUrl("", "/ws"), null);
});

test("配坏了也返回 null，不把不合法的地址传给 fetch / WebSocket", () => {
  assert.equal(workerUrl("live.example.com", "/ws"), null, "缺协议");
  assert.equal(workerUrl("不是地址", "/ws"), null, "根本不是 URL");
  assert.equal(workerUrl("wss://live.example.com/ws", "/ws", { websocket: true }), null);
});
