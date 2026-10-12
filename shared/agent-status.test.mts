import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchText } from "./agent-status.ts";

test("5xx 是可恢复错误，第一次失败后还会再试一次并成功", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) return new Response("", { status: 502 });
    return new Response("ok", { status: 200 });
  });
  assert.equal(await fetchText("https://status.example.com/feed"), "ok");
  assert.equal(calls, 2);
});

test("4xx 是对方明确拒绝，不重试，直接抛出", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("", { status: 404 });
  });
  await assert.rejects(fetchText("https://status.example.com/feed"), (error: Error) => {
    assert.match(error.message, /^404 /);
    return true;
  });
  assert.equal(calls, 1);
});

test("两次都 5xx，重试用尽后仍然抛出最后一次的错误", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("", { status: 500 });
  });
  await assert.rejects(fetchText("https://status.example.com/feed"), (error: Error) => {
    assert.match(error.message, /^500 /);
    return true;
  });
  assert.equal(calls, 2);
});
