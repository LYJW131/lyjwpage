import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EARLY_LIVE_SOCKET_KEY,
  EARLY_LIVE_SOCKET_QUEUE_LIMIT,
  EARLY_LIVE_SOCKET_WATCHDOG_MS,
  earlyLiveSocketScript,
} from "./live-socket-boot.ts";

const URL_ = "wss://api.homepage.lyjw.llc/ws";
const OPENED = `${URL_}?visible=1`;

test("生成的内联脚本是合法 JS —— 它走 dangerouslySetInnerHTML，引号错一个就静默炸掉", () => {
  const script = earlyLiveSocketScript(URL_);
  assert.doesNotThrow(() => new Function(script));
  assert.ok(script.includes(JSON.stringify(OPENED)), "地址原样进脚本，带上可见");
  assert.ok(script.includes(`window.${EARLY_LIVE_SOCKET_KEY}`), "交接字段名要和 hook 读的一致");
  assert.ok(script.includes(String(EARLY_LIVE_SOCKET_WATCHDOG_MS)), "自毁时限要写进脚本");
});

test("脚本里不可能出现 </script>", () => {
  const script = earlyLiveSocketScript("wss://evil.example/</script><script>alert(1)</script>");
  assert.ok(!script.toLowerCase().includes("</script"), "`<` 必须转成 \\u003c");
  assert.doesNotThrow(() => new Function(script));
});

test("脚本真的会开连接、攒消息，并在没人接手时自毁", async () => {
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
    earlyLiveSocketScript(URL_),
  );
  run(
    win,
    { visibilityState: "visible" },
    FakeSocket,
    (fn: () => void, ms: number) => timers.push({ fn, ms }) - 1,
    () => {},
  );

  const early = win[EARLY_LIVE_SOCKET_KEY] as { socket: FakeSocket; queue: string[] };
  assert.ok(early, "可见时要把连接挂到 window 上");
  assert.equal(early.socket.url, OPENED);
  assert.deepEqual(early.queue, []);

  const online = JSON.stringify({ type: "online", payload: { online: 3 } });
  const desktop = JSON.stringify({ type: "desktop", payload: {} });
  early.socket.onmessage?.({ data: online });
  early.socket.onmessage?.({ data: desktop });
  assert.deepEqual(early.queue, [online, desktop]);
  for (let i = 0; i < EARLY_LIVE_SOCKET_QUEUE_LIMIT; i++) early.socket.onmessage?.({ data: "x" });
  assert.equal(early.queue.length, EARLY_LIVE_SOCKET_QUEUE_LIMIT, "页面卡死时不无限攒");

  assert.equal(timers[0]?.ms, EARLY_LIVE_SOCKET_WATCHDOG_MS);
  timers[0]?.fn();
  assert.equal(early.socket.closed, true);
  assert.equal(win[EARLY_LIVE_SOCKET_KEY], undefined);
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
    earlyLiveSocketScript(URL_),
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
  assert.equal(win[EARLY_LIVE_SOCKET_KEY], undefined);
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
    earlyLiveSocketScript(URL_),
  );
  run(win, { visibilityState: "visible" }, FakeSocket, () => 0, () => {});

  const early = win[EARLY_LIVE_SOCKET_KEY] as { socket: FakeSocket };
  assert.ok(early);
  early.socket.onerror?.();
  assert.equal(win[EARLY_LIVE_SOCKET_KEY], undefined, "内联脚本不重连，只负责让位");
});
