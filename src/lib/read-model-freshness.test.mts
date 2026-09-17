import assert from "node:assert/strict";
import test from "node:test";
import { authoritativeReadPath, markLiveRead } from "./read-model-freshness.ts";

test("read model freshness: cold page may use KV; a pushed path permanently bypasses it", () => {
  const path = "/api/status/watching";
  assert.equal(authoritativeReadPath(path), path);
  markLiveRead(path);
  assert.equal(authoritativeReadPath(path), `${path}?fresh=1`);
  assert.equal(authoritativeReadPath(`${path}?since=123`), `${path}?since=123&fresh=1`);
  assert.equal(authoritativeReadPath(`${path}?fresh=0&since=123`), `${path}?fresh=1&since=123`);
  // No shared cache key migration and no collateral bypass of unrelated cards.
  assert.equal(authoritativeReadPath("/api/status/github-repo"), "/api/status/github-repo");
  markLiveRead(path);
  assert.equal(authoritativeReadPath(path), `${path}?fresh=1`);
});

test("read model freshness: timestamp-free PlayStation pushes get the same protection", () => {
  const path = "/api/status/playing";
  markLiveRead(path);
  assert.equal(authoritativeReadPath(path), `${path}?fresh=1`);
});

test("read model freshness: live and incremental endpoints keep their original query contract", () => {
  for (const path of ["/api/status/charger", "/api/status/desktop", "/api/status/listening/now", "/api/status/vibecoding"]) {
    markLiveRead(path);
    assert.equal(authoritativeReadPath(path), path);
    assert.equal(authoritativeReadPath(`${path}?since=123`), `${path}?since=123`);
  }
});
