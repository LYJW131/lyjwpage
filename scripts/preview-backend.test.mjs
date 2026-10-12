import assert from "node:assert/strict";
import test from "node:test";

import { isMatchingPreview } from "./preview-backend.mjs";
import { PREVIEW_REVISION_PATH } from "./preview-worker-name.mjs";

const origin = "https://branch-api.example";

test("本提交且状态读取就绪的 Preview 才算匹配", async () => {
  const calls = [];
  const matched = await isMatchingPreview(origin, "sha", async (url) => {
    calls.push(url);
    return Response.json(url.endsWith(PREVIEW_REVISION_PATH) ? { commitSha: "sha" } : { ok: true });
  });
  assert.equal(matched, true);
  assert.deepEqual(calls, [`${origin}${PREVIEW_REVISION_PATH}`, `${origin}/api/status/listening/now`]);
});

test("还挂着旧提交时不查就绪", async () => {
  const calls = [];
  const matched = await isMatchingPreview(origin, "new-sha", async (url) => {
    calls.push(url);
    return Response.json({ commitSha: "old-sha" });
  });
  assert.equal(matched, false);
  assert.deepEqual(calls, [`${origin}${PREVIEW_REVISION_PATH}`]);
});

test("状态读取没就绪或请求出错都不算匹配", async () => {
  assert.equal(await isMatchingPreview(origin, "sha", async (url) => (
    url.endsWith(PREVIEW_REVISION_PATH) ? Response.json({ commitSha: "sha" }) : new Response(null, { status: 503 })
  )), false);
  assert.equal(await isMatchingPreview(origin, "sha", async () => { throw new TypeError("fetch failed"); }), false);
  assert.equal(await isMatchingPreview(null, "sha", async () => Response.json({ commitSha: "sha" })), false);
});
