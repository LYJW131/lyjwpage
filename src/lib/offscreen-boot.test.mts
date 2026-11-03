import assert from "node:assert/strict";
import { test } from "node:test";

import { OFFSCREEN_REVEALED_CLASS, offscreenRestoreScript, SCROLL_POSITIONS_KEY, syncOffscreenToDocument } from "./offscreen-boot.ts";

function run(state: unknown, stored: string | null | (() => never)) {
  const viaScript = runOnce(state, stored, (globals) =>
    new Function("history", "sessionStorage", "document", offscreenRestoreScript())(globals.history, globals.sessionStorage, globals.document),
  );
  const viaSync = runOnce(state, stored, (globals) => syncOffscreenToDocument(globals as unknown as Parameters<typeof syncOffscreenToDocument>[0]));
  assert.equal(viaSync, viaScript);
  return viaScript;
}

function runOnce(state: unknown, stored: string | null | (() => never), exec: (globals: { history: unknown; sessionStorage: unknown; document: unknown }) => void) {
  const classes = new Set<string>();
  const sessionStorage = {
    getItem(key: string) {
      if (typeof stored === "function") return stored();
      return key === SCROLL_POSITIONS_KEY ? stored : null;
    },
  };
  const document = { documentElement: { classList: { add: (name: string) => classes.add(name) } } };
  exec({ history: { state }, sessionStorage, document });
  return classes.has(OFFSCREEN_REVEALED_CLASS);
}

test("会恢复到页面中间的那次加载，首帧前撤掉屏外占位", () => {
  assert.equal(run({ key: "abc" }, JSON.stringify({ abc: 1400, other: 0 })), true);
});

test("从顶部刷新、首次进入、没存过位置都保留占位", () => {
  assert.equal(run({ key: "abc" }, JSON.stringify({ abc: 0 })), false);
  assert.equal(run(null, JSON.stringify({ abc: 1400 })), false);
  assert.equal(run({ key: "new" }, JSON.stringify({ abc: 1400 })), false);
  assert.equal(run({ key: "abc" }, null), false);
});

test("存储读不了或内容坏了不抛错", () => {
  assert.equal(run({ key: "abc" }, "{not json"), false);
  assert.equal(
    run({ key: "abc" }, () => {
      throw new Error("SecurityError");
    }),
    false,
  );
});

test("会话存储整个读不到时不抛错", () => {
  const classes = new Set<string>();
  const globals = {
    history: { state: { key: "abc" } },
    get sessionStorage(): never {
      throw new Error("SecurityError");
    },
    document: { documentElement: { classList: { add: (name: string) => classes.add(name) } } },
  };
  assert.doesNotThrow(() => syncOffscreenToDocument(globals as unknown as Parameters<typeof syncOffscreenToDocument>[0]));
  assert.equal(classes.has(OFFSCREEN_REVEALED_CLASS), false);
});
