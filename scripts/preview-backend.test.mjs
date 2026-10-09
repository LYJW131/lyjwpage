import assert from "node:assert/strict";
import test from "node:test";

import { findMatchingPreview } from "./preview-backend.mjs";
import { PREVIEW_REVISION_PATH } from "./preview-worker-name.mjs";

const origins = ["https://branch-api.example", "https://branch-ai.example"];

test("AI-only 分支使用同一提交的 ai Preview，跳过 api 的旧版本", async () => {
  const calls = [];
  const found = await findMatchingPreview(origins, "new-sha", async (url) => {
    calls.push(url);
    if (url.endsWith(PREVIEW_REVISION_PATH)) {
      return Response.json({ commitSha: url.startsWith(origins[0]) ? "old-sha" : "new-sha" });
    }
    return Response.json({ ok: true });
  });
  assert.equal(found, origins[1]);
  assert.equal(calls.includes(`${origins[0]}/api/status/listening/now`), false);
  assert.equal(calls.includes(`${origins[1]}/api/status/listening/now`), true);
});

test("两个候选同时检查，不等待失联的 Preview 才使用可用版本", async () => {
  const calls = [];
  const found = await findMatchingPreview(origins, "sha", async (url) => {
    calls.push(url);
    if (url.startsWith(origins[0])) return new Promise(() => {});
    return Response.json(url.endsWith(PREVIEW_REVISION_PATH) ? { commitSha: "sha" } : { ok: true });
  });
  assert.equal(found, origins[1]);
  assert.deepEqual(calls.slice(0, 2), origins.map((origin) => `${origin}${PREVIEW_REVISION_PATH}`));
});

test("未提供提交或只有旧版本时不采用分支地址", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json({ commitSha: "old-sha" }); };
  assert.equal(await findMatchingPreview(origins, undefined, fetchImpl), null);
  assert.equal(calls, 0);
  assert.equal(await findMatchingPreview(origins, "new-sha", fetchImpl), null);
});

test("revision 匹配但状态端点失败、revision 无效或不可访问时均不采用", async () => {
  for (const failure of ["status", "json", "http", "network"]) {
    const found = await findMatchingPreview(origins, "sha", async (url) => {
      if (failure === "network") throw new Error("offline");
      if (failure === "http") return new Response(null, { status: 404 });
      if (failure === "json") return new Response("invalid");
      return url.endsWith(PREVIEW_REVISION_PATH)
        ? Response.json({ commitSha: "sha" })
        : new Response(null, { status: 503 });
    });
    assert.equal(found, null, failure);
  }
});
