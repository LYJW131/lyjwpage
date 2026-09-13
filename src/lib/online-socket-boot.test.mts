import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EARLY_ONLINE_SOCKET_KEY,
  EARLY_ONLINE_SOCKET_WATCHDOG_MS,
  earlyOnlineSocketScript,
} from "./online-socket-boot.ts";

const URL_ = "wss://online.homepage.lyjw.llc/ws";

test("生成的内联脚本是合法 JS —— 它走 dangerouslySetInnerHTML，引号错一个就静默炸掉", () => {
  const script = earlyOnlineSocketScript(URL_);
  assert.doesNotThrow(() => new Function(script));
  assert.ok(script.includes(JSON.stringify(URL_)), "地址要原样进脚本");
  assert.ok(script.includes(`window.${EARLY_ONLINE_SOCKET_KEY}`), "交接字段名要和 hook 读的一致");
  assert.ok(script.includes(String(EARLY_ONLINE_SOCKET_WATCHDOG_MS)), "自毁时限要写进脚本");
});

test("脚本里不可能出现 </script>", () => {
  // 正常情况下 workerUrl 已经把地址限死成 wss://host/path，但转义是这里的责任
  const script = earlyOnlineSocketScript("wss://evil.example/</script><script>alert(1)</script>");
  assert.ok(!script.toLowerCase().includes("</script"), "`<` 必须转成 \\u003c");
  assert.doesNotThrow(() => new Function(script));
});

test("脚本真的会开连接、记人数，并在没人接手时自毁", async () => {
  // 用一对最小替身跑一遍脚本本体，验证行为而不是字符串长相
  const timers: { fn: () => void; ms: number }[] = [];
  const sockets: FakeSocket[] = [];

  class FakeSocket {
    url: string;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }
    close() {
      this.closed = true;
    }
  }

  const win: Record<string, unknown> = {};
  const run = new Function(
    "window",
    "document",
    "WebSocket",
    "setTimeout",
    "clearTimeout",
    earlyOnlineSocketScript(URL_),
  );
  run(
    win,
    { visibilityState: "visible" },
    FakeSocket,
    (fn: () => void, ms: number) => timers.push({ fn, ms }) - 1,
    () => {},
  );

  const early = win[EARLY_ONLINE_SOCKET_KEY] as { socket: FakeSocket; count?: number };
  assert.ok(early, "可见时要把连接挂到 window 上");
  assert.equal(early.socket.url, URL_);
  assert.equal(early.count, undefined);

  // 房间连上就广播一次人数，交接前一直覆盖成最新的那条
  early.socket.onmessage?.({ data: JSON.stringify({ online: 3 }) });
  assert.equal(early.count, 3);
  early.socket.onmessage?.({ data: JSON.stringify({ online: 5 }) });
  assert.equal(early.count, 5);
  early.socket.onmessage?.({ data: "不是 JSON" });
  assert.equal(early.count, 5, "脏消息不该把已经收到的人数冲掉");

  // 没人接手：到点自己关掉并摘掉字段，免得人数虚高到 Worker 清扫为止
  assert.equal(timers[0]?.ms, EARLY_ONLINE_SOCKET_WATCHDOG_MS);
  timers[0]?.fn();
  assert.equal(early.socket.closed, true);
  assert.equal(win[EARLY_ONLINE_SOCKET_KEY], undefined);
});

test("页面不可见时根本不开这条连接", () => {
  const win: Record<string, unknown> = {};
  let built = 0;
  const run = new Function(
    "window",
    "document",
    "WebSocket",
    "setTimeout",
    "clearTimeout",
    earlyOnlineSocketScript(URL_),
  );
  run(
    win,
    { visibilityState: "hidden" },
    function () {
      built += 1;
    },
    () => 0,
    () => {},
  );
  assert.equal(built, 0);
  assert.equal(win[EARLY_ONLINE_SOCKET_KEY], undefined);
});

test("连不上时自己摘掉字段，交给 hook 走它那套重连退避", () => {
  const win: Record<string, unknown> = {};
  class FakeSocket {
    onmessage: unknown = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    close() {}
  }
  const run = new Function(
    "window",
    "document",
    "WebSocket",
    "setTimeout",
    "clearTimeout",
    earlyOnlineSocketScript(URL_),
  );
  run(win, { visibilityState: "visible" }, FakeSocket, () => 0, () => {});

  const early = win[EARLY_ONLINE_SOCKET_KEY] as { socket: FakeSocket };
  assert.ok(early);
  early.socket.onerror?.();
  assert.equal(win[EARLY_ONLINE_SOCKET_KEY], undefined, "内联脚本不重连，只负责让位");
});
