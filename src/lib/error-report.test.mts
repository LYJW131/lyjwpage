import assert from "node:assert/strict";
import test from "node:test";

process.env.PUBLIC_BACKEND_URL = "https://lyjw.me";
const { relayTarget } = await import("./error-report.ts");

test("production pages report straight to the backend so ESA visitors keep their own rate-limit key", () => {
  assert.equal(relayTarget("lyjw131.com"), "https://lyjw.me/relay");
  assert.equal(relayTarget("lyjw.me"), "https://lyjw.me/relay");
  assert.equal(relayTarget("claude-x.preview.lyjw.dev"), "/relay");
  assert.equal(relayTarget("localhost:3211"), "/relay");
});
